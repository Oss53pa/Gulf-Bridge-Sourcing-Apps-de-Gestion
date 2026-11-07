-- Récupération automatique des taux USD et CNY depuis les taux de référence
-- quotidiens de la Banque centrale européenne (BCE).
--
-- Le XOF a une parité fixe avec l'euro (taux EUR de gbs.taux_change, 655,957) :
-- 1 USD = parité EUR/XOF ÷ (USD pour 1 EUR publié par la BCE), idem pour le CNY.
--
-- La requête HTTP passe par pg_net (asynchrone) : un premier appel de
-- gbs.importer_taux_bce() envoie la requête, un appel suivant lit la réponse.
-- Une tâche pg_cron l'appelle toutes les 15 minutes en fin d'après-midi.
-- Toute réponse est contrôlée avant écriture : statut HTTP, taille, XML sans
-- DOCTYPE, date récente, taux dans des bornes plausibles, variation bornée.
-- Un taux refusé n'est jamais écrit ; le refus est tracé dans gbs.imports_taux.

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('taux.source_url', '"https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"', date '2026-01-01',
   'Taux de référence quotidiens de la BCE (base EUR)'),
  ('taux.variation_max', '0.10', date '2026-01-01',
   'Variation maximale acceptée par rapport au dernier taux connu ; au-delà, saisie manuelle'),
  ('taux.requetes_max_jour', '6', date '2026-01-01', 'Nombre maximal de requêtes vers la source par jour'),
  ('taux.borne.USD', '[0.5, 2.5]', date '2026-01-01', 'USD pour 1 EUR : bornes de plausibilité'),
  ('taux.borne.CNY', '[3, 15]', date '2026-01-01', 'CNY pour 1 EUR : bornes de plausibilité');

create table gbs.imports_taux (
  id          bigint generated always as identity primary key,
  requete_id  bigint,
  demande_le  timestamptz not null default now(),
  traite_le   timestamptz,
  statut      text not null default 'demande'
              check (statut in ('demande','importe','deja_connu','rejete','erreur')),
  date_taux   date,
  taux        jsonb,
  motif       text check (length(motif) <= 300)
);
alter table gbs.imports_taux enable row level security;
grant select on gbs.imports_taux to authenticated;
create policy imports_taux_lecture on gbs.imports_taux for select
  using (gbs_private.has_role('admin','comptable'));

-- Analyse et contrôle d'un document BCE. Lève GBS_TAUX_REJETE avec le motif.
create or replace function gbs_private.analyser_bce(p_contenu text)
returns table (date_taux date, devise text, taux_eur numeric)
language plpgsql stable set search_path = '' as $$
declare
  doc xml; ns text[] := array[array['e', 'http://www.ecb.int/vocabulary/2002-08-01/eurofxref']];
  d date; v text; b jsonb; dev text;
begin
  if p_contenu is null or length(p_contenu) = 0 or length(p_contenu) > 65536 then
    raise exception 'GBS_TAUX_REJETE: réponse vide ou trop volumineuse' using errcode = 'P0001';
  end if;
  if p_contenu ~* '<!(DOCTYPE|ENTITY)' then
    raise exception 'GBS_TAUX_REJETE: déclaration DOCTYPE ou ENTITY refusée' using errcode = 'P0001';
  end if;
  begin
    doc := xmlparse(document p_contenu);
  exception when others then
    raise exception 'GBS_TAUX_REJETE: XML invalide' using errcode = 'P0001';
  end;
  v := (pg_catalog.xpath('//e:Cube[@time]/@time', doc, ns))[1]::text;
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'GBS_TAUX_REJETE: date absente' using errcode = 'P0001';
  end if;
  d := v::date;
  if d > current_date or d < current_date - 7 then
    raise exception 'GBS_TAUX_REJETE: date de publication hors plage (%)', d using errcode = 'P0001';
  end if;
  foreach dev in array array['USD','CNY'] loop
    v := (pg_catalog.xpath('//e:Cube[@currency="' || dev || '"]/@rate', doc, ns))[1]::text;
    if v is null or v !~ '^\d{1,6}(\.\d{1,8})?$' then
      raise exception 'GBS_TAUX_REJETE: taux % absent ou mal formé', dev using errcode = 'P0001';
    end if;
    b := gbs_private.param('taux.borne.' || dev, d);
    if v::numeric < (b ->> 0)::numeric or v::numeric > (b ->> 1)::numeric then
      raise exception 'GBS_TAUX_REJETE: taux % hors bornes (%)', dev, v using errcode = 'P0001';
    end if;
    date_taux := d; devise := dev; taux_eur := v::numeric;
    return next;
  end loop;
end $$;

create or replace function gbs.importer_taux_bce()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  imp gbs.imports_taux; rep record; r record; parite numeric; dernier numeric; xof numeric;
  var_max numeric; lot jsonb; nouveaux int; n_req int; id_req bigint; resultat jsonb := '[]'::jsonb;
  traite boolean := false;
begin
  perform gbs_private.exiger(gbs_private.is_admin() or coalesce(auth.role(), '') = 'service_role');
  perform pg_catalog.pg_advisory_xact_lock(7321);
  var_max := gbs_private.param_num('taux.variation_max');

  -- 1. Réponses en attente.
  for imp in select * from gbs.imports_taux where statut = 'demande' order by id for update loop
    select status_code, content, timed_out, error_msg into rep
      from net._http_response where id = imp.requete_id;
    traite := traite or found;
    if not found then
      if imp.demande_le < now() - interval '30 minutes' then
        update gbs.imports_taux set statut = 'erreur', traite_le = now(), motif = 'Aucune réponse de la source'
         where id = imp.id;
        resultat := resultat || jsonb_build_object('import', imp.id, 'statut', 'erreur');
      end if;
      continue;
    end if;
    if coalesce(rep.timed_out, false) or rep.status_code is distinct from 200 then
      update gbs.imports_taux set statut = 'erreur', traite_le = now(),
        motif = left('Réponse HTTP ' || coalesce(rep.status_code::text, 'absente')
                     || coalesce(' — ' || rep.error_msg, ''), 300)
       where id = imp.id;
      resultat := resultat || jsonb_build_object('import', imp.id, 'statut', 'erreur');
      continue;
    end if;
    begin
      lot := '{}'::jsonb; nouveaux := 0;
      for r in select * from gbs_private.analyser_bce(rep.content) loop
        parite := gbs_private.taux_xof('EUR', r.date_taux);
        xof := round(parite / r.taux_eur, 8);
        select t.taux_xof into dernier from gbs.taux_change t
         where t.devise = r.devise and t.date_taux < r.date_taux order by t.date_taux desc limit 1;
        if dernier is not null and abs(xof / dernier - 1) > var_max then
          raise exception 'GBS_TAUX_REJETE: variation de % % sur % (% → %), saisie manuelle requise',
            round(100 * (xof / dernier - 1), 1), '%', r.devise, dernier, xof using errcode = 'P0001';
        end if;
        lot := lot || jsonb_build_object(r.devise, jsonb_build_object('pour_1_eur', r.taux_eur, 'xof', xof));
        insert into gbs.taux_change (devise, date_taux, taux_xof, source)
        values (r.devise, r.date_taux, xof, 'BCE (taux de référence) — parité EUR/XOF ' || parite)
        on conflict (devise, date_taux) do nothing;
        if found then nouveaux := nouveaux + 1; end if;
      end loop;
      update gbs.imports_taux set statut = case when nouveaux > 0 then 'importe' else 'deja_connu' end,
        traite_le = now(), date_taux = r.date_taux, taux = lot, motif = null
       where id = imp.id;
      resultat := resultat || jsonb_build_object('import', imp.id, 'statut',
        case when nouveaux > 0 then 'importe' else 'deja_connu' end, 'date_taux', r.date_taux);
    exception when sqlstate 'P0001' then
      -- Toute écriture de taux de ce lot est annulée avec le bloc.
      update gbs.imports_taux set statut = 'rejete', traite_le = now(),
        motif = left(regexp_replace(sqlerrm, '^GBS_TAUX_REJETE: ', ''), 300)
       where id = imp.id;
      resultat := resultat || jsonb_build_object('import', imp.id, 'statut', 'rejete');
    end;
  end loop;

  -- 2. Nouvelle requête, au plus tôt à l'appel suivant d'un traitement, si aucune n'est
  -- en cours, n'a abouti ou n'a été rejetée aujourd'hui (une publication rejetée le
  -- serait de nouveau : elle attend une saisie manuelle). Seules les erreurs réseau
  -- sont retentées, dans la limite du plafond journalier.
  if not traite and not exists (select 1 from gbs.imports_taux
                   where statut in ('demande','importe','deja_connu','rejete') and demande_le >= current_date) then
    select count(*) into n_req from gbs.imports_taux where demande_le >= current_date;
    if n_req < gbs_private.param_num('taux.requetes_max_jour') then
      id_req := net.http_get(url := gbs_private.param('taux.source_url') #>> '{}', timeout_milliseconds := 10000);
      insert into gbs.imports_taux (requete_id) values (id_req);
      resultat := resultat || jsonb_build_object('requete', id_req, 'statut', 'demande');
    end if;
  end if;
  return resultat;
end $$;

revoke execute on function gbs.importer_taux_bce(), gbs_private.analyser_bce(text) from public;
grant execute on function gbs.importer_taux_bce() to authenticated, service_role;
grant execute on function gbs_private.analyser_bce(text) to authenticated, service_role;
