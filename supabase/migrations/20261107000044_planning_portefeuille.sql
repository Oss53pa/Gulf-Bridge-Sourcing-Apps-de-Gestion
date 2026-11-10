-- Section Planning du module Dossiers (maquette « Gantt du portefeuille », « Rétroplanning »,
-- « Jours ouvrés et fériés »). Fonctions de lecture uniquement, visibilité des dossiers inchangée.
-- * gbs.gantt_portefeuille : une ligne par phase des dossiers ouverts visibles, avec début et fin
--   réels, ou projetés par le rétroplanning quand la date d'ouverture du site est connue.
-- * gbs.echeances_en_cours : l'échéance de la phase en cours de chaque dossier ouvert, en jours
--   ouvrés du pays du responsable, horloge arrêtée pendant l'attente d'un tiers, fériés décomptés.
-- * gbs.calculer_echeance : échéance après n jours ouvrés dans le calendrier d'un pays.

create or replace function gbs.gantt_portefeuille()
returns table (dossier_id uuid, reference text, client text, chef_id uuid, date_ouverture date,
               marge_jours int, intenable boolean, phase text, ordre int, statut text,
               debut date, fin date, en_retard boolean)
language plpgsql stable security definer set search_path = '' as $$
declare d record; plan jsonb; e record; p jsonb;
begin
  perform gbs_private.exiger(gbs_private.interne());
  for d in select x.id, x.reference, x.chef_id, x.date_ouverture_site, cl.raison_sociale
             from gbs.dossiers x join gbs.clients cl on cl.id = x.client_id
            where x.statut = 'ouvert' and gbs_private.dossier_visible(x.id)
            order by x.date_ouverture_site nulls last, x.ouvert_le limit 200 loop
    plan := case when d.date_ouverture_site is not null then gbs_private.planning_ouverture_brut(d.id) end;
    for e in select * from gbs_private.etat_delais_brut(d.id) loop
      select v into p from jsonb_array_elements(coalesce(plan -> 'phases', '[]'::jsonb)) v where v ->> 'phase' = e.phase;
      dossier_id := d.id; reference := d.reference; client := d.raison_sociale; chef_id := d.chef_id;
      date_ouverture := d.date_ouverture_site;
      marge_jours := (plan ->> 'marge_jours_ouvres')::int;
      intenable := coalesce((plan ->> 'intenable')::boolean, false);
      phase := e.phase; ordre := e.ordre; statut := e.statut;
      debut := coalesce(e.debut, (p ->> 'debut_projete')::date);
      fin := coalesce(e.fin, (p ->> 'fin_projetee')::date, e.echeance);
      en_retard := coalesce((p ->> 'en_retard')::boolean, false) or e.voyant = 'rouge';
      return next;
    end loop;
  end loop;
end $$;

create or replace function gbs.echeances_en_cours()
returns table (dossier_id uuid, reference text, client text, phase text, pays text, debut date, cible int,
               jours_arretes int, echeance date, reste_jours int, feries int, voyant text)
language plpgsql stable security definer set search_path = '' as $$
declare d record; e record;
begin
  perform gbs_private.exiger(gbs_private.interne());
  for d in select x.id, x.reference, x.phase_courante, cl.raison_sociale
             from gbs.dossiers x join gbs.clients cl on cl.id = x.client_id
            where x.statut = 'ouvert' and gbs_private.dossier_visible(x.id) limit 300 loop
    select * into e from gbs_private.etat_delais_brut(d.id) z where z.phase = d.phase_courante;
    if e.echeance is null then continue; end if;
    dossier_id := d.id; reference := d.reference; client := d.raison_sociale; phase := e.phase;
    pays := e.pays_calendrier; debut := e.debut; cible := e.cible; jours_arretes := coalesce(e.jours_externes, 0);
    echeance := e.echeance; voyant := e.voyant;
    reste_jours := case when e.echeance >= current_date then gbs_private.jours_ouvres_entre(e.pays_calendrier, current_date, e.echeance)
                        else -gbs_private.jours_ouvres_entre(e.pays_calendrier, e.echeance, current_date) end;
    select count(*)::int into feries from gbs.calendrier c
     where c.pays = e.pays_calendrier and c.nature = 'ferie' and c.jour > e.debut and c.jour <= e.echeance
       and extract(isodow from c.jour) < 6;
    return next;
  end loop;
end $$;

create or replace function gbs.calculer_echeance(p_pays text, p_debut date, p_jours int)
returns date language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.interne());
  if p_pays is null or p_pays not in ('CN','CI','GA','CM') or p_debut is null or p_jours is null
     or p_jours < 0 or p_jours > 365 or p_debut not between date '2020-01-01' and date '2099-12-31' then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  return gbs_private.ajouter_jours_ouvres(p_pays, p_debut, p_jours);
end $$;

revoke all on function gbs.gantt_portefeuille(), gbs.echeances_en_cours(), gbs.calculer_echeance(text, date, int) from public, anon;
grant execute on function gbs.gantt_portefeuille(), gbs.echeances_en_cours(), gbs.calculer_echeance(text, date, int) to authenticated;
