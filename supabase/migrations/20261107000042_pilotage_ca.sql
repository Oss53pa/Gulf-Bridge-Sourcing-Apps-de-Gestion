-- Pilotage (M15) : chiffre d'affaires mensuel, budget, prévision et point mort.
-- * Budget mensuel et charges fixes annuelles : paramètres datés, par code de société
--   (« pilotage.budget_ca_mensuel_xof.GBS_CI »). Sans paramètre, le budget et le point mort
--   restent vides : rien n'est inventé.
-- * Chiffre d'affaires : même définition que le tableau de bord (factures client émises,
--   montant HT converti en FCFA au taux du jour d'émission).
-- * Prévision des mois à venir : moyenne des trois derniers mois clos, affichée comme telle.
-- * Montants réservés aux profils qui voient les montants (administratrice, comptabilité, Hub).
-- * Budget du mois : valeur en vigueur le dernier jour du mois, sommée sur les sociétés ; non
--   affiché si une société n'en a pas. Point mort : chiffre d'affaires cumulé de l'année rapporté
--   aux charges fixes annuelles, avec le mois où il serait atteint au rythme actuel.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('pilotage.budget_ca_mensuel_xof.*','nombre',0,1e13,null,'pilotage','Budget mensuel de chiffre d''affaires par société (FCFA HT)'),
  ('pilotage.charges_fixes_annuelles_xof.*','nombre',0,1e14,null,'pilotage','Charges fixes annuelles par société, base du point mort (FCFA)'),
  ('pilotage.mois_historique','entier',3,24,null,'pilotage','Mois passés affichés sur le graphique du chiffre d''affaires'),
  ('pilotage.mois_prevision','entier',0,12,null,'pilotage','Mois à venir affichés en prévision');

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('pilotage.mois_historique', '6', '2026-01-01', 'Valeur initiale'),
  ('pilotage.mois_prevision', '2', '2026-01-01', 'Valeur initiale');

create or replace function gbs_private.param_num_ou_null(p_cle text, p_date date default current_date)
returns numeric language sql stable security definer set search_path = '' as $$
  select (gbs_private.param(p_cle, p_date) #>> '{}')::numeric
$$;
revoke all on function gbs_private.param_num_ou_null(text, date) from public, anon, authenticated;

create or replace function gbs.pilotage_ca(p_societe uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r text := gbs_private.role();
  nb_passes int := coalesce(gbs_private.param_num_ou_null('pilotage.mois_historique'), 6)::int;
  nb_futurs int := coalesce(gbs_private.param_num_ou_null('pilotage.mois_prevision'), 2)::int;
  mois_courant date := date_trunc('month', current_date)::date;
  debut_annee date := date_trunc('year', current_date)::date;
  socs uuid[];
  serie jsonb := '[]'::jsonb;
  m date; ca numeric; bud numeric; budget_complet boolean; prev numeric;
  charges numeric; charges_completes boolean; cumul numeric; moyenne numeric; mois_ecoules numeric;
  atteint date; par_soc jsonb;
begin
  perform gbs_private.exiger(r is not null and r not in ('client','fournisseur','transitaire'));
  if p_societe is not null then perform gbs_private.exiger(gbs_private.societe_ok(p_societe)); end if;
  if r not in ('admin','comptable','hub_afrique') then
    return jsonb_build_object('montants_visibles', false);
  end if;

  select coalesce(array_agg(s.id), '{}') into socs from gbs.societes s
   where (p_societe is null or s.id = p_societe) and gbs_private.societe_ok(s.id);

  select coalesce(sum(round(gbs_private.to_xof(f.montant_ht, f.devise, f.date_emission))), 0) / 3 into prev
    from gbs.factures f
   where f.statut in ('emise','partiellement_payee','payee') and f.client_id is not null
     and f.societe_id = any(socs)
     and f.date_emission >= (mois_courant - interval '3 months')::date and f.date_emission < mois_courant;

  for i in reverse nb_passes - 1 .. -nb_futurs loop
    m := (mois_courant - make_interval(months => i))::date;
    select sum(gbs_private.param_num_ou_null('pilotage.budget_ca_mensuel_xof.' || s.code, (m + interval '1 month' - interval '1 day')::date)),
           bool_and(gbs_private.param_num_ou_null('pilotage.budget_ca_mensuel_xof.' || s.code, (m + interval '1 month' - interval '1 day')::date) is not null)
      into bud, budget_complet
      from gbs.societes s where s.id = any(socs);
    if i >= 0 then
      select coalesce(sum(round(gbs_private.to_xof(f.montant_ht, f.devise, f.date_emission))), 0) into ca
        from gbs.factures f
       where f.statut in ('emise','partiellement_payee','payee') and f.client_id is not null
         and f.societe_id = any(socs)
         and f.date_emission >= m and f.date_emission < (m + interval '1 month')::date;
    else
      ca := null;
    end if;
    serie := serie || jsonb_build_object(
      'mois', to_char(m, 'YYYY-MM'),
      'ca_xof', ca,
      'budget_xof', case when coalesce(budget_complet, false) then bud end,
      'prevision_xof', case when i < 0 then round(prev) end,
      'en_cours', i = 0);
  end loop;

  select sum(gbs_private.param_num_ou_null('pilotage.charges_fixes_annuelles_xof.' || s.code)),
         bool_and(gbs_private.param_num_ou_null('pilotage.charges_fixes_annuelles_xof.' || s.code) is not null)
    into charges, charges_completes
    from gbs.societes s where s.id = any(socs);
  select coalesce(sum(round(gbs_private.to_xof(f.montant_ht, f.devise, f.date_emission))), 0) into cumul
    from gbs.factures f
   where f.statut in ('emise','partiellement_payee','payee') and f.client_id is not null
     and f.societe_id = any(socs) and f.date_emission >= debut_annee;
  mois_ecoules := greatest(extract(month from current_date) - 1 + extract(day from current_date) / 30.0, 0.5);
  moyenne := cumul / mois_ecoules;
  if coalesce(charges_completes, false) and charges > 0 then
    if cumul >= charges then
      atteint := mois_courant;
    elsif moyenne > 0 then
      atteint := (debut_annee + make_interval(months => ceil(charges / moyenne)::int - 1))::date;
      if atteint >= (debut_annee + interval '1 year')::date then atteint := null; end if;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('societe_id', x.id, 'code', x.code, 'ca_xof', x.ca) order by x.ca desc), '[]'::jsonb)
    into par_soc
    from (select s.id, s.code,
                 coalesce(sum(case when f.id is not null then round(gbs_private.to_xof(f.montant_ht, f.devise, f.date_emission)) end), 0) as ca
            from gbs.societes s
            left join gbs.factures f on f.societe_id = s.id and f.client_id is not null
                 and f.statut in ('emise','partiellement_payee','payee') and f.date_emission >= debut_annee
           where s.id = any(socs) group by s.id, s.code) x;

  return jsonb_build_object(
    'montants_visibles', true,
    'mois', serie,
    'point_mort', jsonb_build_object(
      'charges_fixes_xof', case when coalesce(charges_completes, false) then charges end,
      'ca_cumule_xof', cumul,
      'taux', case when coalesce(charges_completes, false) and charges > 0 then round(cumul / charges, 4) end,
      'atteint_le', to_char(atteint, 'YYYY-MM')),
    'par_societe', par_soc);
end $$;
revoke all on function gbs.pilotage_ca(uuid) from public, anon;
grant execute on function gbs.pilotage_ca(uuid) to authenticated;
