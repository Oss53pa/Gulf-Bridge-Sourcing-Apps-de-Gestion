-- Corrections de la relecture des portails déjà en production (migrations 58 à 68).
-- * Un fournisseur suspendu, radié ou sous correspondance confirmée aux sanctions ne lit plus une consultation
--   depuis son compte et n'y dépose plus d'offre, ni par son compte ni par lien (l'invitation ne suffit plus).
-- * Lecture des fichiers par un compte client : seulement sous le dossier concerné (une pièce ou une photo dont
--   le chemin pointerait ailleurs n'ouvre plus rien).
-- * Photos de production : plafond total par commande (paramètre daté) et limitation de débit par compte.
-- * Demande de compte fournisseur : une valeur trop longue répond « paramètres invalides », pas une erreur brute.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('production.photos_max_commande', 'entier', 12, 2000, null, 'achats', 'Photos de production au plus par commande');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('production.photos_max_commande', '120', date '2026-01-01', 'Plafond de stockage des photos de production par commande');

create or replace function gbs_private.fournisseur_bloque(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from gbs.fournisseurs x where x.id = f and x.statut_agrement in ('suspendu','radie'))
      or gbs_private.sanction_confirmee(f)
$$;

-- Limiteur pour un compte désigné (fonctions appelées par le rôle de service au nom d'un compte externe).
create or replace function gbs_private.limiter_compte(p_profil uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare n int; h timestamptz := date_trunc('hour', now());
begin
  if not exists (select 1 from gbs.profils p where p.id = p_profil and p.role in ('client','fournisseur')) then return; end if;
  delete from gbs.limites_debit where heure < now() - interval '2 days' and profil_id = p_profil;
  insert into gbs.limites_debit (profil_id, action, heure) values (p_profil, p_action, h)
  on conflict (profil_id, action, heure) do update set nombre = gbs.limites_debit.nombre + 1 returning nombre into n;
  if n > gbs_private.param_num('portail.max_ecritures_heure')::int then
    raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001';
  end if;
end $$;

create or replace function gbs_private.consultation_du_compte(p_consultation uuid)
 RETURNS gbs.consultations_fournisseurs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := gbs_private.mon_fournisseur(); c gbs.consultations_fournisseurs;
begin
  select * into c from gbs.consultations_fournisseurs where id = p_consultation;
  perform gbs_private.exiger(f is not null and c.id is not null and c.statut <> 'annulee'
    and exists (select 1 from gbs.consultation_invites i where i.consultation_id = c.id and i.fournisseur_id = f)
    and not gbs_private.fournisseur_bloque(f));
  return c;
end $function$;

create or replace function gbs.deposer_pli_compte(p_user uuid, p_consultation uuid, p_chiffre text, p_iv text, p_empreinte text, p_complet boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pr gbs.profils; c gbs.consultations_fournisseurs; p gbs.plis;
begin
  select * into pr from gbs.profils where id = p_user;
  if pr.id is null or not pr.actif or pr.role is distinct from 'fournisseur' or pr.fournisseur_id is null or pr.sous_role is distinct from 'commercial' then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  select * into c from gbs.consultations_fournisseurs where id = p_consultation for update;
  if c.id is null or not exists (select 1 from gbs.consultation_invites i where i.consultation_id = c.id and i.fournisseur_id = pr.fournisseur_id)
     or gbs_private.fournisseur_bloque(pr.fournisseur_id) then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  if c.statut <> 'ouverte' or c.date_limite <= now() then raise exception 'GBS_CONSULTATION_CLOSE' using errcode = 'P0001'; end if;
  if p_complet is null or p_empreinte is null or p_empreinte !~ '^[0-9a-f]{64}$' then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if (select count(*) from gbs.plis x where x.consultation_id = c.id and x.fournisseur_id = pr.fournisseur_id)
     >= gbs_private.param_num('fournisseur.depots_max') then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'plis', true);
  update gbs.plis set statut = 'remplace', remplace_le = now()
   where consultation_id = c.id and fournisseur_id = pr.fournisseur_id and statut = 'depose';
  insert into gbs.plis (consultation_id, fournisseur_id, depose_par, chiffre, iv, empreinte, complet)
  values (c.id, pr.fournisseur_id, pr.id, p_chiffre, p_iv, p_empreinte, p_complet)
  returning * into p;
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('depose_le', p.depose_le, 'empreinte', p.empreinte, 'complet', p.complet, 'date_limite', c.date_limite);
end $function$;

create or replace function gbs.deposer_pli(p_jeton text, p_chiffre text, p_iv text, p_empreinte text, p_complet boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l gbs.liens_fournisseurs; c gbs.consultations_fournisseurs; p gbs.plis;
begin
  l := gbs_private.lien_fournisseur(p_jeton, false);
  select * into c from gbs.consultations_fournisseurs where id = l.consultation_id for update;
  if gbs_private.fournisseur_bloque(l.fournisseur_id) then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
  if c.statut <> 'ouverte' or c.date_limite <= now() then raise exception 'GBS_CONSULTATION_CLOSE' using errcode = 'P0001'; end if;
  if p_complet is null or p_empreinte !~ '^[0-9a-f]{64}$' then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if (select count(*) from gbs.plis x where x.consultation_id = l.consultation_id and x.fournisseur_id = l.fournisseur_id)
     >= gbs_private.param_num('fournisseur.depots_max') then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'plis', true);
  update gbs.plis set statut = 'remplace', remplace_le = now()
   where consultation_id = l.consultation_id and fournisseur_id = l.fournisseur_id and statut = 'depose';
  insert into gbs.plis (consultation_id, fournisseur_id, lien_id, chiffre, iv, empreinte, complet)
  values (l.consultation_id, l.fournisseur_id, l.id, p_chiffre, p_iv, p_empreinte, p_complet)
  returning * into p;
  perform set_config('gbs.rpc', '', true);
  -- Accusé de réception : heure de dépôt et empreinte, que le fournisseur conserve.
  return jsonb_build_object('depose_le', p.depose_le, 'empreinte', p.empreinte, 'complet', p.complet, 'date_limite', c.date_limite);
end $function$;

create or replace function gbs_private.document_visible(p_bucket text, p_nom text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_bucket = 'gbs-documents' and (
    (p_nom ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.dossier_visible(substring(p_nom from 1 for 36)::uuid))
    or (p_nom ~ '^frais/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.interne()
       and (substring(p_nom from 7 for 36)::uuid = auth.uid() or gbs_private.has_role('admin','comptable')))
    or (p_nom ~ '^prospects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.prospect_visible(substring(p_nom from 11 for 36)::uuid))
    or (p_nom ~ '^dd/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.has_role('admin','achats_chine'))
    or (gbs_private.mon_client() is not null and exists (
         select 1 from gbs.pieces p join gbs.dossiers d on d.id = p.dossier_id
          where p.document_chemin = p_nom and p_nom like d.id::text || '/%'
            and p.statut = 'validee' and d.client_id = gbs_private.mon_client() and d.statut <> 'annule'
            and gbs_private.piece_visible_client(p.code, d.mode_financier)))
    or (gbs_private.mon_client() is not null and exists (
         select 1 from gbs.photos_production ph join gbs.avancements_production av on av.id = ph.avancement_id join gbs.dossiers d on d.id = ph.dossier_id
          where ph.chemin = p_nom and p_nom like d.id::text || '/%'
            and av.publie_le is not null and d.client_id = gbs_private.mon_client() and d.statut <> 'annule'))
    or (gbs_private.mon_fournisseur() is not null and exists (
         select 1 from gbs.photos_production ph join gbs.commandes k on k.id = ph.commande_id
          where ph.chemin = p_nom and k.fournisseur_id = gbs_private.mon_fournisseur())))
$function$;

create or replace function gbs.verifier_depot_photo_production(p_commande uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := gbs_private.mon_fournisseur(); k gbs.commandes;
begin
  select * into k from gbs.commandes where id = p_commande;
  perform gbs_private.exiger(f is not null and k.id is not null and k.fournisseur_id = f
    and k.statut in ('contrat_signe','en_production','production_terminee'));
  if (select count(*) from gbs.photos_production p where p.commande_id = k.id and p.avancement_id is null) >= 12
     or (select count(*) from gbs.photos_production p where p.commande_id = k.id) >= gbs_private.param_num('production.photos_max_commande') then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  return k.dossier_id;
end $function$;

create or replace function gbs.enregistrer_photo_production(p_user uuid, p_commande uuid, p_chemin text, p_empreinte text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pr gbs.profils; k gbs.commandes;
begin
  select * into pr from gbs.profils where id = p_user;
  select * into k from gbs.commandes where id = p_commande for update;
  if pr.id is null or not pr.actif or pr.role is distinct from 'fournisseur' or k.id is null or k.fournisseur_id is distinct from pr.fournisseur_id
     or k.statut not in ('contrat_signe','en_production','production_terminee') then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  if p_chemin is null or not gbs_private.photos_valides(k.dossier_id, array[p_chemin]) or p_chemin !~ '\.(jpg|png|webp)$'
     or p_empreinte is null or p_empreinte !~ '^[0-9a-f]{64}$' then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if (select count(*) from gbs.photos_production p where p.commande_id = k.id and p.avancement_id is null) >= 12
     or (select count(*) from gbs.photos_production p where p.commande_id = k.id) >= gbs_private.param_num('production.photos_max_commande') then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  perform gbs_private.limiter_compte(pr.id, 'photo_production');
  perform gbs_private.rpc('avancement');
  insert into gbs.photos_production (commande_id, dossier_id, chemin, empreinte, auteur_id) values (k.id, k.dossier_id, p_chemin, p_empreinte, pr.id);
  perform gbs_private.rpc('');
end $function$;

create or replace function gbs.demander_compte_fournisseur(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := gbs_private.mon_fournisseur(); r uuid; n int;
begin
  perform gbs_private.exiger(f is not null and exists (select 1 from gbs.profils x where x.id = auth.uid() and x.sous_role = 'finance'));
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('type','titulaire','devise','banque','numero','swift','titulaire_est_entreprise','motif'))
     or coalesce(jsonb_typeof(p -> 'type'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'titulaire'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'devise'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'numero'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'motif'), '') <> 'string'
     or (p ? 'banque' and jsonb_typeof(p -> 'banque') not in ('string','null'))
     or (p ? 'swift' and jsonb_typeof(p -> 'swift') not in ('string','null'))
     or (p ? 'titulaire_est_entreprise' and jsonb_typeof(p -> 'titulaire_est_entreprise') <> 'boolean') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('gbs.demandes_comptes.' || f::text));
  if exists (select 1 from gbs.demandes_comptes_fournisseurs where fournisseur_id = f and statut = 'nouvelle') then
    raise exception 'GBS_DEMANDE_EN_COURS' using errcode = 'P0001';
  end if;
  select count(*) into n from gbs.demandes_comptes_fournisseurs where fournisseur_id = f and cree_le > now() - interval '30 days';
  if n >= gbs_private.param_num('portail.max_demandes_compte_30j', current_date) then
    raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('demande_compte');
  insert into gbs.demandes_comptes_fournisseurs (fournisseur_id, auteur_id, type, titulaire, devise, banque, numero, swift, titulaire_est_entreprise, motif)
  values (f, auth.uid(), p ->> 'type', trim(p ->> 'titulaire'), p ->> 'devise', nullif(trim(p ->> 'banque'), ''), trim(p ->> 'numero'),
          nullif(upper(trim(p ->> 'swift')), ''), coalesce((p ->> 'titulaire_est_entreprise')::boolean, true), trim(p ->> 'motif'))
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or string_data_right_truncation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $function$;

revoke all on function gbs_private.fournisseur_bloque(uuid), gbs_private.limiter_compte(uuid, text) from public, anon, authenticated;
