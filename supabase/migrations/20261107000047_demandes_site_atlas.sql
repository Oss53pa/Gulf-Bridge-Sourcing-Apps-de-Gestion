-- M1 : demandes du formulaire de contact du site www.gulfbridgesourcing.com créées en prospects.
-- Le site n'appelle pas gbs-demande : son formulaire enregistre chaque demande dans le module
-- « Sites clients » de la console Atlas Studio (public.client_site_leads, site 'gulf-bridge-sourcing'),
-- qui garde la notification par e-mail. L'application les reprend par importation périodique :
-- * lecture seule de la table d'Atlas Studio, aucun déclencheur posé dessus : une panne côté GBS
--   ne peut jamais bloquer l'envoi du formulaire ;
-- * une demande n'est importée qu'une fois (gbs.demandes_site_importees), même en cas d'échec,
--   consigné par un code générique, sans donnée personnelle ;
-- * champs repris un à un et revalidés ; ce que le formulaire ne fournit pas est déduit :
--   pays par l'indicatif du téléphone (sinon « ZZ », pays à préciser, confié au Hub Afrique),
--   spécialité par le service choisi (sinon « autre »), page d'origine reconstruite en https ;
-- * envoyer le formulaire vaut accord pour être recontacté sur cette demande : consentement
--   daté de la réception ;
-- * même adresse e-mail dans les 24 heures : rattachée au prospect existant ;
-- * la tâche « premier contact sous 1 jour ouvré » est créée par le déclencheur des prospects.
-- Planification (pg_cron, toutes les 5 minutes) : voir README, « Tâches planifiées ».

create table gbs.demandes_site_importees (
  lead_id      uuid primary key,
  prospect_id  uuid references gbs.prospects(id),
  doublon      boolean not null default false,
  erreur       text check (erreur in ('GBS_DEMANDE_INVALIDE')),
  importe_le   timestamptz not null default now(),
  check ((prospect_id is null) = (erreur is not null))
);
alter table gbs.demandes_site_importees enable row level security;
revoke all on gbs.demandes_site_importees from public, anon, authenticated;

create or replace function gbs_private.pays_par_indicatif(p_tel text) returns text
language sql immutable set search_path = '' as $$
  select case
    when t like '225%' then 'CI' when t like '241%' then 'GA' when t like '237%' then 'CM'
    when t like '86%' then 'CN' when t like '221%' then 'SN' when t like '229%' then 'BJ'
    when t like '228%' then 'TG' when t like '226%' then 'BF' when t like '223%' then 'ML'
    when t like '242%' then 'CG' when t like '243%' then 'CD' when t like '33%' then 'FR'
    else 'ZZ' end
  from (select case when p_tel ~ '^\s*(\+|00)' then regexp_replace(regexp_replace(p_tel, '^\s*(\+|00)', ''), '[^0-9]', '', 'g') end as t) x
$$;

create or replace function gbs_private.specialite_par_service(p_service text) returns text
language sql immutable set search_path = '' as $$
  select case
    when s ~ '(equipement|amenagement|hotel|chambre|site)' then 'equipement_site'
    when s ~ '(approvisionnement|industri|piece|consommable|mine|petrol)' then 'approvisionnement_industriel'
    else 'autre' end
  from (select lower(translate(coalesce(p_service, ''), 'ÉÈÊËÀÂÎÏÔÛÙÇéèêëàâîïôûùç', 'EEEEAAIIOUUCeeeeaaiioouuc')) as s) x
$$;

create or replace function gbs_private.importer_demandes_site(p_max int default 50) returns int
language plpgsql security definer set search_path = '' as $$
declare l record; n int := 0; existant uuid; nouveau uuid; v_tel text; v_email text; v_page text; v_pays text;
begin
  if to_regclass('public.client_site_leads') is null then return 0; end if;
  for l in execute
    'select l.id, l.name, l.company, l.email, l.phone, l.service, l.message, l.page, l.created_at, s.domain
       from public.client_site_leads l join public.client_sites s on s.id = l.site_id
      where l.site_id = ''gulf-bridge-sourcing''
        and not exists (select 1 from gbs.demandes_site_importees i where i.lead_id = l.id)
      order by l.created_at limit $1' using least(greatest(coalesce(p_max, 50), 1), 200)
  loop
    begin
      v_email := nullif(lower(trim(l.email)), '');
      if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then v_email := null; end if;
      v_tel := nullif(trim(l.phone), '');
      if v_tel is not null and v_tel !~ '^[0-9+() .-]{6,40}$' then v_tel := null; end if;
      v_pays := gbs_private.pays_par_indicatif(v_tel);
      v_page := case when coalesce(l.domain, '') ~ '^[a-z0-9.-]{3,253}$' and coalesce(l.page, '') ~ '^[A-Za-z0-9/_-]{0,100}$'
                   then 'https://' || l.domain || '/' || case when l.page = 'accueil' then '' else coalesce(l.page, '') end end;

      select p.id into existant from gbs.prospects p
       where v_email is not null and lower(p.email) = v_email and p.source = 'site_web'
         and p.cree_le >= l.created_at - interval '24 hours' order by p.cree_le desc limit 1;
      if existant is not null then
        insert into gbs.prospects_actions (prospect_id, type, date_action, compte_rendu)
        values (existant, 'demande_site', l.created_at::date,
                left('Nouvelle demande du site : ' || coalesce(nullif(trim(l.message), ''), '(sans message)'), 4000));
        insert into gbs.demandes_site_importees (lead_id, prospect_id, doublon) values (l.id, existant, true);
      else
        perform set_config('gbs.rpc', 'demande_site', true);
        insert into gbs.prospects (raison_sociale, contact_nom, email, telephone, pays, specialite, segment, source,
                                   page_origine, message, langue, consentement_le, responsable_id)
        values (left(trim(coalesce(nullif(trim(l.company), ''), l.name)), 200), nullif(left(trim(l.name), 120), ''), v_email, v_tel,
                v_pays, gbs_private.specialite_par_service(l.service), nullif(left(trim(l.service), 80), ''), 'site_web',
                v_page, nullif(left(trim(l.message), 4000), ''), 'fr', l.created_at, gbs_private.responsable_prospect(v_pays))
        returning id into nouveau;
        perform set_config('gbs.rpc', '', true);
        insert into gbs.demandes_site_importees (lead_id, prospect_id) values (l.id, nouveau);
      end if;
      n := n + 1;
    -- Demande inexploitable (donnée ou contrainte) : consignée, jamais réessayée. Toute autre
    -- erreur interrompt l'importation sans rien marquer, et reste visible dans le journal de pg_cron.
    exception when data_exception or integrity_constraint_violation then
      perform set_config('gbs.rpc', '', true);
      insert into gbs.demandes_site_importees (lead_id, erreur) values (l.id, 'GBS_DEMANDE_INVALIDE');
    end;
    existant := null; nouveau := null;
  end loop;
  return n;
end $$;

revoke all on function gbs_private.importer_demandes_site(int), gbs_private.pays_par_indicatif(text),
  gbs_private.specialite_par_service(text) from public, anon, authenticated;

-- Un prospect au pays inconnu (« ZZ ») ne devient pas client : le pays décide de la société
-- contractante et de la devise. L'équipe le précise d'abord sur la fiche du prospect.
create or replace function gbs_private.trg_prospect_pays_connu() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.statut = 'converti' and old.statut is distinct from 'converti' and new.pays = 'ZZ' then
    raise exception 'GBS_PAYS_A_PRECISER' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger prospects_pays_connu before update on gbs.prospects for each row execute function gbs_private.trg_prospect_pays_connu();
revoke all on function gbs_private.trg_prospect_pays_connu() from public, anon, authenticated;
