-- Portail fournisseur : répondre à une consultation depuis le compte (maquette « Espace fournisseur ·
-- cotations »), sans lien par jeton. Mêmes règles que le formulaire par lien :
-- * Le contenu de l'offre est chiffré par la fonction serveur gbs-fournisseur (clé hors de la base) ;
--   le dépôt n'est exécutable que par le rôle de service, jamais directement par le compte : un pli
--   non chiffré par la fonction bloquerait l'ouverture de tous les plis de la consultation.
-- * Accès : compte fournisseur actif en double facteur (mon_fournisseur), fournisseur invité,
--   consultation ouverte avant la date limite ; dépôt réservé au sous-rôle commercial.
-- * Plafonds communs avec le lien : versions de pli et questions par fournisseur et consultation.
-- * Un pli déposé par le compte porte son auteur (depose_par) au lieu du lien.

alter table gbs.plis alter column lien_id drop not null;
alter table gbs.plis add column depose_par uuid references gbs.profils(id),
  add constraint plis_origine check ((lien_id is null) <> (depose_par is null));
grant select (depose_par) on gbs.plis to authenticated;

create or replace function gbs_private.trg_pli_fige() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.consultation_id, new.fournisseur_id, new.lien_id, new.depose_par, new.depose_le, new.chiffre, new.iv, new.empreinte, new.complet)
     is distinct from (old.consultation_id, old.fournisseur_id, old.lien_id, old.depose_par, old.depose_le, old.chiffre, old.iv, old.empreinte, old.complet) then
    raise exception 'GBS_PLI_FIGE: un pli déposé ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Consultation accessible au compte : invité, non annulée. Renvoie la consultation (ou refuse).
create or replace function gbs_private.consultation_du_compte(p_consultation uuid) returns gbs.consultations_fournisseurs
language plpgsql stable security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur(); c gbs.consultations_fournisseurs;
begin
  select * into c from gbs.consultations_fournisseurs where id = p_consultation;
  perform gbs_private.exiger(f is not null and c.id is not null and c.statut <> 'annulee'
    and exists (select 1 from gbs.consultation_invites i where i.consultation_id = c.id and i.fournisseur_id = f));
  return c;
end $$;

-- Lecture : même liste blanche que le formulaire par lien (ni client, ni dossier, ni autre fournisseur).
create or replace function gbs.formulaire_fournisseur_compte(p_consultation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c gbs.consultations_fournisseurs := gbs_private.consultation_du_compte(p_consultation); f uuid := gbs_private.mon_fournisseur(); p gbs.plis;
begin
  select * into p from gbs.plis where consultation_id = c.id and fournisseur_id = f and statut <> 'remplace';
  return jsonb_build_object(
    'consultation', jsonb_build_object('reference', c.reference, 'objet', c.objet, 'specifications', c.specifications, 'quantite', c.quantite,
      'incoterm_demande', c.incoterm_demande, 'lieu', c.lieu, 'date_limite', c.date_limite, 'fuseau', c.fuseau,
      'ouverte', c.statut = 'ouverte' and c.date_limite > now()),
    'fournisseur', (select x.raison_sociale_en from gbs.fournisseurs x where x.id = f),
    'peut_deposer', (select pr.sous_role = 'commercial' from gbs.profils pr where pr.id = auth.uid()),
    'pli', case when p.id is null then null else jsonb_build_object('depose_le', p.depose_le, 'empreinte', p.empreinte, 'complet', p.complet) end,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('question', q.question, 'reponse', q.reponse, 'repondu_le', q.repondu_le,
                                  'mienne', q.fournisseur_id = f) order by q.posee_le)
                             from gbs.questions_consultation q
                            where q.consultation_id = c.id and (q.reponse is not null or q.fournisseur_id = f)), '[]'::jsonb));
end $$;

create or replace function gbs.poser_question_compte(p_consultation uuid, p_question text)
returns void language plpgsql security definer set search_path = '' as $$
declare c gbs.consultations_fournisseurs := gbs_private.consultation_du_compte(p_consultation); f uuid := gbs_private.mon_fournisseur();
begin
  if c.statut <> 'ouverte' or c.date_limite <= now() then raise exception 'GBS_CONSULTATION_CLOSE' using errcode = 'P0001'; end if;
  if p_question is null or length(trim(p_question)) not between 5 and 2000 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('gbs.questions.' || c.id::text || f::text));
  if (select count(*) from gbs.questions_consultation q where q.consultation_id = c.id and q.fournisseur_id = f)
     >= gbs_private.param_num('fournisseur.questions_max') then
    raise exception 'GBS_TROP_DE_QUESTIONS' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'plis', true);
  insert into gbs.questions_consultation (consultation_id, fournisseur_id, question) values (c.id, f, trim(p_question));
  perform set_config('gbs.rpc', '', true);
end $$;

-- Dépôt (rôle de service, appelé par gbs-fournisseur après contrôle de la session du compte).
create or replace function gbs.deposer_pli_compte(p_user uuid, p_consultation uuid, p_chiffre text, p_iv text, p_empreinte text, p_complet boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pr gbs.profils; c gbs.consultations_fournisseurs; p gbs.plis;
begin
  select * into pr from gbs.profils where id = p_user;
  if pr.id is null or not pr.actif or pr.role is distinct from 'fournisseur' or pr.fournisseur_id is null or pr.sous_role is distinct from 'commercial' then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  select * into c from gbs.consultations_fournisseurs where id = p_consultation for update;
  if c.id is null or not exists (select 1 from gbs.consultation_invites i where i.consultation_id = c.id and i.fournisseur_id = pr.fournisseur_id) then
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
end $$;

-- Espace fournisseur : consultations où il est invité (et non plus seulement celles avec un lien), avec leur identifiant.
create or replace function gbs.espace_fournisseur()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur(); x gbs.fournisseurs; p gbs.profils;
begin
  perform gbs_private.exiger(f is not null);
  select * into x from gbs.fournisseurs where id = f;
  select * into p from gbs.profils where id = auth.uid();
  return jsonb_build_object(
    'utilisateur', jsonb_build_object('nom', p.nom, 'sous_role', p.sous_role, 'langue', p.langue),
    'fournisseur', jsonb_build_object('reference', x.reference, 'raison_sociale_en', x.raison_sociale_en, 'raison_sociale_zh', x.raison_sociale_zh,
                     'statut_agrement', x.statut_agrement, 'note', x.note, 'engagement_non_commission_le', x.engagement_non_commission_le,
                     'due_diligence_jusqu_au', (select max(d.valide_jusqu_au) from gbs.due_diligences d where d.fournisseur_id = f and d.statut = 'validee')),
    'consultations', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'reference', c.reference, 'objet', c.objet, 'quantite', c.quantite,
                        'incoterm', c.incoterm_demande, 'lieu', c.lieu, 'date_limite', c.date_limite, 'fuseau', c.fuseau, 'statut', c.statut,
                        'pli_depose_le', (select max(k.depose_le) from gbs.plis k where k.consultation_id = c.id and k.fournisseur_id = f and k.statut <> 'remplace'))
                        order by c.date_limite desc), '[]'::jsonb)
                      from gbs.consultations_fournisseurs c
                     where exists (select 1 from gbs.consultation_invites i where i.consultation_id = c.id and i.fournisseur_id = f) and c.statut <> 'annulee'),
    'commandes', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'reference', k.reference, 'statut', k.statut, 'incoterm', k.incoterm, 'lieu', k.lieu,
                    'devise', k.devise, 'fob_montant', k.fob_montant,
                    'lignes', (select coalesce(jsonb_agg(jsonb_build_object('designation', a.designation, 'quantite', l.quantite,
                                 'prix_unitaire', l.prix_unitaire, 'montant', l.montant) order by l.cree_le), '[]'::jsonb)
                               from gbs.lignes_commande l join gbs.articles a on a.id = l.article_id where l.commande_id = k.id),
                    'paiements', (select coalesce(jsonb_agg(jsonb_build_object('nature', y.nature, 'montant', y.montant, 'devise', y.devise,
                                    'etat', case when y.statut in ('execute','confirme_client') then 'recu' when y.statut = 'refuse' then 'annule' else 'a_venir' end,
                                    'date', case when y.statut in ('execute','confirme_client') then y.execute_le end) order by y.cree_le), '[]'::jsonb)
                                  from gbs.paiements_fournisseurs y where y.commande_id = k.id))
                    order by k.reference desc), '[]'::jsonb)
                  from gbs.commandes k where k.fournisseur_id = f and k.statut <> 'brouillon'),
    'comptes', (select coalesce(jsonb_agg(jsonb_build_object('type', cp.type, 'banque', cp.banque, 'fin_numero', right(cp.numero, 4),
                  'verifie', cp.verifie, 'verifie_le', cp.verifie_le) order by cp.verifie desc), '[]'::jsonb)
                from gbs.comptes_paiement cp where cp.fournisseur_id = f)
  );
end $$;

revoke all on function gbs_private.consultation_du_compte(uuid) from public, anon, authenticated;
revoke all on function gbs.formulaire_fournisseur_compte(uuid), gbs.poser_question_compte(uuid, text) from public, anon;
grant execute on function gbs.formulaire_fournisseur_compte(uuid), gbs.poser_question_compte(uuid, text) to authenticated;
revoke all on function gbs.deposer_pli_compte(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function gbs.deposer_pli_compte(uuid, uuid, text, text, text, boolean) to service_role;
