-- Lot 1, M22 et M15 : notes de frais, coûts par dossier, marge directe par mission
-- et liste des missions à perte (cahier des charges, section 5, « Analytique des
-- coûts et marge réelle »). La marge complète (quote-part des frais fixes selon le
-- temps passé), la vue par société et consolidée, la clôture analytique et le
-- budget au devis relèvent du lot 2.

-- -----------------------------------------------------------------------------
-- Justificatifs des notes de frais : frais/<utilisateur>/<uuid>.<ext>, lisibles par
-- leur auteur, l'administratrice et la comptabilité.
-- -----------------------------------------------------------------------------
create or replace function gbs_private.document_visible(p_bucket text, p_nom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_bucket = 'gbs-documents' and (
    (p_nom ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.dossier_visible(substring(p_nom from 1 for 36)::uuid))
    or (p_nom ~ '^frais/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.interne()
       and (substring(p_nom from 7 for 36)::uuid = auth.uid() or gbs_private.has_role('admin','comptable'))))
$$;

-- -----------------------------------------------------------------------------
-- Coûts et notes de frais.
-- -----------------------------------------------------------------------------
create table gbs.couts (
  id            uuid primary key default gen_random_uuid(),
  nature        text not null check (nature in ('note_frais','cout')),
  dossier_id    uuid references gbs.dossiers(id),
  frais_generaux boolean not null default false,
  categorie     text not null check (categorie in ('inspecteur','deplacement','hebergement','repas','echantillon','coursier',
                  'laboratoire','traduction','sous_traitance','commission_agent','transitaire','frais_bancaires','change',
                  'installation','apres_livraison','autre')),
  libelle       text not null check (length(libelle) between 3 and 300),
  date_cout     date not null check (date_cout >= date '2026-01-01'),
  devise        char(3) not null check (devise in ('XOF','XAF','USD','CNY','EUR')),
  montant_ht    numeric(16,2) not null check (montant_ht > 0 and montant_ht < 1e12),
  montant_xof   numeric(16,0),
  cause_perte   text check (cause_perte in ('jours_depasses','contre_inspection_non_facturee','deplacement_imprevu')),
  justificatif_chemin text check (length(justificatif_chemin) <= 400),
  statut        text not null default 'soumise' check (statut in ('soumise','validee','refusee','remboursee')),
  depose_par    uuid references gbs.profils(id),
  valide_par    uuid references gbs.profils(id),
  valide_le     timestamptz,
  motif_refus   text check (length(motif_refus) <= 1000),
  rembourse_le  date,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (not (frais_generaux and dossier_id is not null))
);
create index on gbs.couts (dossier_id);
create index on gbs.couts (depose_par);
create trigger couts_touch before update on gbs.couts for each row execute function gbs_private.trg_touch();
create trigger couts_cree before insert on gbs.couts for each row execute function gbs_private.trg_cree_par();
create trigger couts_audit after insert or update or delete on gbs.couts for each row execute function gbs_private.trg_audit();
create trigger couts_nodel before delete on gbs.couts for each row execute function gbs_private.trg_no_delete();

-- Répartition d'un coût partagé entre dossiers, selon le temps passé.
create table gbs.couts_repartition (
  cout_id     uuid not null references gbs.couts(id),
  dossier_id  uuid not null references gbs.dossiers(id),
  heures      numeric(8,2) not null check (heures > 0 and heures <= 10000),
  montant_xof numeric(16,0) not null,
  primary key (cout_id, dossier_id)
);
create trigger repartition_audit after insert or update or delete on gbs.couts_repartition for each row execute function gbs_private.trg_audit();
create trigger repartition_immuable before update or delete on gbs.couts_repartition for each row execute function gbs_private.trg_immuable();

create or replace function gbs_private.finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.has_role('admin','comptable')
$$;

-- Règles d'écriture : conversion en FCFA au cours du jour de la dépense, justificatif
-- rangé au bon endroit, statut tenu par les fonctions dédiées, auteur figé.
create or replace function gbs_private.trg_cout() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  if tg_op = 'INSERT' then
    new.depose_par := coalesce(auth.uid(), new.depose_par);
    new.valide_par := null; new.valide_le := null; new.rembourse_le := null; new.motif_refus := null;
    -- Un coût saisi par la finance est validé d'emblée ; une note de frais attend sa validation.
    new.statut := case when new.nature = 'cout' then 'validee' else 'soumise' end;
    if new.nature = 'cout' then
      if not (gbs_private.finance() or current_user not in ('authenticated','anon')) then
        raise exception 'GBS_ACCES_REFUSE: les coûts sont saisis par la finance' using errcode = '42501';
      end if;
      new.valide_par := auth.uid(); new.valide_le := now();
    end if;
  else
    if (new.statut, new.valide_par, new.valide_le, new.rembourse_le, new.motif_refus)
       is distinct from (old.statut, old.valide_par, old.valide_le, old.rembourse_le, old.motif_refus)
       and rpc <> 'statuer_cout' then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
    if new.depose_par is distinct from old.depose_par or new.nature is distinct from old.nature then
      raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
    end if;
    if old.statut in ('validee','remboursee') and rpc <> 'statuer_cout'
       and (new.montant_ht, new.devise, new.date_cout, new.categorie, new.justificatif_chemin)
           is distinct from (old.montant_ht, old.devise, old.date_cout, old.categorie, old.justificatif_chemin) then
      raise exception 'GBS_COUT_FIGE: coût validé ; saisissez une correction' using errcode = 'P0001';
    end if;
  end if;
  if new.justificatif_chemin is not null and new.justificatif_chemin !~ (
       '^(frais/' || coalesce(new.depose_par::text, '-') || '|' || coalesce(new.dossier_id::text, '-')
       || ')/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$') then
    raise exception 'GBS_JUSTIFICATIF_INVALIDE' using errcode = '22023';
  end if;
  new.montant_xof := round(gbs_private.to_xof(new.montant_ht, new.devise, new.date_cout));
  return new;
end $$;
-- Exécutée avec les droits de l'appelant : current_user distingue l'utilisateur de l'API.
alter function gbs_private.trg_cout() security invoker;
create trigger couts_regles before insert or update on gbs.couts
  for each row execute function gbs_private.trg_cout();

alter table gbs.couts enable row level security;
alter table gbs.couts_repartition enable row level security;
grant select, insert, update on gbs.couts to authenticated;
grant select on gbs.couts_repartition to authenticated;
create policy couts_lecture on gbs.couts for select using (
  gbs_private.interne() and (depose_par = auth.uid() or gbs_private.finance()));
create policy couts_creation on gbs.couts for insert with check (
  gbs_private.interne() and (dossier_id is null or gbs_private.dossier_visible(dossier_id)));
-- L'auteur corrige sa note tant qu'elle est soumise ; la finance affecte et corrige.
create policy couts_maj on gbs.couts for update using (
  gbs_private.interne() and ((depose_par = auth.uid() and statut = 'soumise') or gbs_private.finance()))
  with check (gbs_private.interne() and (dossier_id is null or gbs_private.dossier_visible(dossier_id)));
create policy repartition_lecture on gbs.couts_repartition for select using (gbs_private.finance());

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('frais.justificatif_obligatoire', '["deplacement","hebergement","repas"]', date '2026-01-01',
   'Catégories de notes de frais exigeant la photo du justificatif');

-- Validation, refus ou remboursement d'une note de frais (finance, jamais l'auteur).
create or replace function gbs.statuer_cout(p_cout uuid, p_decision text, p_motif text default null)
returns gbs.couts language plpgsql security definer set search_path = '' as $$
declare c gbs.couts; exige jsonb;
begin
  select * into c from gbs.couts where id = p_cout for update;
  perform gbs_private.exiger(c.id is not null and gbs_private.finance(), 'GBS_VALIDATION_ADMIN');
  if c.depose_par = auth.uid() then
    raise exception 'GBS_QUATRE_YEUX' using errcode = 'P0001';
  end if;
  if not ((p_decision in ('validee','refusee') and c.statut = 'soumise')
          or (p_decision = 'remboursee' and c.statut = 'validee' and c.nature = 'note_frais')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_decision = 'validee' then
    if c.dossier_id is null and not c.frais_generaux then
      raise exception 'GBS_COUT_NON_AFFECTE: affectez la dépense à un dossier ou aux frais généraux' using errcode = 'P0001';
    end if;
    exige := gbs_private.param('frais.justificatif_obligatoire');
    if c.justificatif_chemin is null and exige ? c.categorie then
      raise exception 'GBS_JUSTIFICATIF_MANQUANT' using errcode = 'P0001';
    end if;
  end if;
  if p_decision = 'refusee' then perform gbs_private.motif(p_motif); end if;
  perform gbs_private.rpc('statuer_cout');
  update gbs.couts set statut = p_decision,
         valide_par = case when p_decision in ('validee','refusee') then auth.uid() else valide_par end,
         valide_le = case when p_decision in ('validee','refusee') then now() else valide_le end,
         motif_refus = case when p_decision = 'refusee' then p_motif else motif_refus end,
         rembourse_le = case when p_decision = 'remboursee' then current_date else rembourse_le end
   where id = p_cout returning * into c;
  perform gbs_private.rpc('');
  return c;
end $$;

-- Coût partagé : répartition au prorata du temps passé ; la règle est tracée au journal.
create or replace function gbs.repartir_cout(p_cout uuid, p_parts jsonb, p_motif text)
returns setof gbs.couts_repartition language plpgsql security definer set search_path = '' as $$
declare c gbs.couts; total_h numeric; reste numeric; x record; n int; i int := 0; part numeric;
begin
  perform gbs_private.exiger(gbs_private.finance(), 'GBS_VALIDATION_ADMIN');
  perform gbs_private.motif(p_motif);
  select * into c from gbs.couts where id = p_cout for update;
  if c.id is null or c.statut not in ('validee','remboursee') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) not between 2 and 20
     or exists (select 1 from jsonb_array_elements(p_parts) e
                 where jsonb_typeof(e) <> 'object'
                    or (select count(*) from jsonb_object_keys(e) k where k not in ('dossier_id','heures')) > 0
                    or coalesce(e ->> 'dossier_id', '') !~ '^[0-9a-f-]{36}$'
                    or jsonb_typeof(e -> 'heures') <> 'number' or (e ->> 'heures')::numeric <= 0
                    or not exists (select 1 from gbs.dossiers d where d.id = (e ->> 'dossier_id')::uuid))
     or (select count(distinct e ->> 'dossier_id') from jsonb_array_elements(p_parts) e) <> jsonb_array_length(p_parts) then
    raise exception 'GBS_REPARTITION_INVALIDE' using errcode = '22023';
  end if;
  -- Une répartition est définitive : la corriger passe par un coût de correction.
  if exists (select 1 from gbs.couts_repartition r where r.cout_id = p_cout) then
    raise exception 'GBS_DEJA_REPARTI: saisissez un coût de correction' using errcode = 'P0001';
  end if;
  select sum((e ->> 'heures')::numeric) into total_h from jsonb_array_elements(p_parts) e;
  n := jsonb_array_length(p_parts);
  reste := c.montant_xof;
  for x in select (e ->> 'dossier_id')::uuid as dossier_id, (e ->> 'heures')::numeric as heures
             from jsonb_array_elements(p_parts) e order by e ->> 'dossier_id' loop
    i := i + 1;
    -- Le dernier dossier reçoit le reste : la somme des parts égale toujours le coût.
    part := case when i = n then reste else round(c.montant_xof * x.heures / total_h) end;
    reste := reste - part;
    insert into gbs.couts_repartition (cout_id, dossier_id, heures, montant_xof) values (p_cout, x.dossier_id, x.heures, part);
  end loop;
  return query select * from gbs.couts_repartition where cout_id = p_cout order by dossier_id;
end $$;

-- Coûts imputés à un dossier : coûts propres non répartis et parts de coûts partagés.
create or replace function gbs_private.couts_dossier(p_dossier uuid)
returns table (cout_id uuid, categorie text, cause_perte text, montant_xof numeric)
language sql stable security definer set search_path = '' as $$
  select c.id, c.categorie, c.cause_perte, c.montant_xof::numeric from gbs.couts c
   where c.dossier_id = p_dossier and c.statut in ('validee','remboursee')
     and not exists (select 1 from gbs.couts_repartition r where r.cout_id = c.id)
  union all
  select c.id, c.categorie, c.cause_perte, r.montant_xof::numeric from gbs.couts_repartition r
    join gbs.couts c on c.id = r.cout_id
   where r.dossier_id = p_dossier and c.statut in ('validee','remboursee')
$$;

-- Marge directe d'une mission (dossier) : honoraires HT moins coûts propres, en FCFA,
-- en vue facturée et encaissée, avec la cause principale en cas de perte.
create or replace function gbs_private.marge_directe_brute(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare facture numeric; encaisse numeric; couts numeric; md_f numeric; md_e numeric; cause text; avoirs numeric;
begin
  select coalesce(sum(round(gbs_private.to_xof(f.montant_ht, f.devise, f.date_emission))), 0),
         coalesce(sum(round(gbs_private.to_xof(
           case when f.type = 'avoir' then f.montant_ht
                when f.net_a_payer = 0 then 0 else f.montant_ht * least(f.encaisse / f.net_a_payer, 1) end,
           f.devise, f.date_emission))), 0),
         coalesce(-sum(round(gbs_private.to_xof(f.montant_ht, f.devise, f.date_emission))) filter (where f.type = 'avoir'), 0)
    into facture, encaisse, avoirs
    from gbs.factures f
   where f.dossier_id = p_dossier and f.client_id is not null and f.statut in ('emise','partiellement_payee','payee');
  select coalesce(sum(x.montant_xof), 0) into couts from gbs_private.couts_dossier(p_dossier) x;
  md_f := facture - couts;
  md_e := encaisse - couts;
  if md_f < 0 or md_e < 0 then
    select x.cause_perte into cause from gbs_private.couts_dossier(p_dossier) x
     where x.cause_perte is not null group by x.cause_perte order by sum(x.montant_xof) desc limit 1;
    if cause is null and avoirs > 0 then cause := 'remise_accordee'; end if;
    if cause is null and md_f >= 0 and md_e < 0 then cause := 'impaye'; end if;
    cause := coalesce(cause, 'couts_superieurs');
  end if;
  return jsonb_build_object(
    'honoraires_factures_xof', facture, 'honoraires_encaisses_xof', encaisse, 'couts_xof', couts,
    'marge_directe_facturee_xof', md_f, 'marge_directe_encaissee_xof', md_e,
    'taux_marge_facturee', case when facture > 0 then round(md_f / facture, 4) end,
    'cause_perte', cause,
    'couts_par_categorie', (select coalesce(jsonb_object_agg(categorie, total), '{}'::jsonb)
                              from (select x.categorie, sum(x.montant_xof) total from gbs_private.couts_dossier(p_dossier) x
                                    group by x.categorie) s));
end $$;

create or replace function gbs.marge_directe(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.finance() and gbs_private.dossier_visible(p_dossier));
  return gbs_private.marge_directe_brute(p_dossier);
end $$;

-- Missions à perte : marge directe facturée ou encaissée négative.
create or replace function gbs.missions_a_perte()
returns table (dossier_id uuid, reference text, modele text, client text, honoraires_factures_xof numeric,
               couts_xof numeric, marge_directe_facturee_xof numeric, marge_directe_encaissee_xof numeric, cause_perte text)
language plpgsql stable security definer set search_path = '' as $$
declare d record; m jsonb;
begin
  perform gbs_private.exiger(gbs_private.finance());
  for d in select x.id, x.reference, x.modele, c.raison_sociale from gbs.dossiers x join gbs.clients c on c.id = x.client_id
            where gbs_private.dossier_visible(x.id) order by x.reference loop
    m := gbs_private.marge_directe_brute(d.id);
    if (m ->> 'marge_directe_facturee_xof')::numeric < 0 or (m ->> 'marge_directe_encaissee_xof')::numeric < 0 then
      dossier_id := d.id; reference := d.reference; modele := d.modele; client := d.raison_sociale;
      honoraires_factures_xof := (m ->> 'honoraires_factures_xof')::numeric; couts_xof := (m ->> 'couts_xof')::numeric;
      marge_directe_facturee_xof := (m ->> 'marge_directe_facturee_xof')::numeric;
      marge_directe_encaissee_xof := (m ->> 'marge_directe_encaissee_xof')::numeric;
      cause_perte := m ->> 'cause_perte';
      return next;
    end if;
  end loop;
end $$;

revoke execute on function gbs.statuer_cout(uuid, text, text), gbs.repartir_cout(uuid, jsonb, text),
  gbs.marge_directe(uuid), gbs.missions_a_perte(),
  gbs_private.finance(), gbs_private.trg_cout(), gbs_private.couts_dossier(uuid), gbs_private.marge_directe_brute(uuid) from public;
grant execute on function gbs.statuer_cout(uuid, text, text), gbs.repartir_cout(uuid, jsonb, text),
  gbs.marge_directe(uuid), gbs.missions_a_perte() to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
