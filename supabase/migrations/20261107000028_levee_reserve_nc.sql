-- Lot 1, M28 → M27 : la non-conformité née d'une réserve sur site se clôt à la levée de
-- cette réserve, sans contre-inspection (défaut constaté et corrigé à destination) :
-- la correction et la preuve de la levée y sont reportées, le retard éventuel compté.

create or replace function gbs.lever_reserve(p_reserve uuid, p_preuve text, p_photos text[] default '{}')
returns gbs.reserves_reception language plpgsql security definer set search_path = '' as $$
declare x gbs.reserves_reception; r gbs.receptions; pr text := trim(coalesce(p_preuve, '')); n gbs.non_conformites;
begin
  select * into x from gbs.reserves_reception where id = p_reserve for update;
  perform gbs_private.exiger(x.id is not null and gbs_private.peut_receptionner(x.dossier_id));
  select * into r from gbs.receptions where id = x.reception_id;
  if r.statut <> 'signee' or x.statut <> 'ouverte' then raise exception 'GBS_RECEPTION_STATUT' using errcode = 'P0001'; end if;
  if length(pr) not between 10 and 2000 then raise exception 'GBS_PREUVE_INVALIDE' using errcode = '22023'; end if;
  perform set_config('gbs.rpc', 'reception', true);
  update gbs.reserves_reception set statut = 'levee', preuve = pr, photos_levee = coalesce(p_photos, '{}'),
         levee_le = now(), levee_par = auth.uid()
   where id = p_reserve returning * into x;
  -- Non-conformité ouverte par cette réserve : close sur la levée.
  if x.non_conformite_id is not null then
    select * into n from gbs.non_conformites where id = x.non_conformite_id for update;
    if n.statut <> 'close' then
      perform set_config('gbs.rpc', 'nc', true);
      update gbs.non_conformites set
             correction = coalesce(correction, left('Lever la réserve n° ' || x.numero || ' de la réception ' || r.reference, 4000)),
             correction_exigee_le = coalesce(correction_exigee_le, now()),
             preuve = coalesce(preuve, pr), photos_correction = case when cardinality(photos_correction) = 0 then x.photos_levee else photos_correction end,
             corrigee_le = coalesce(corrigee_le, now()), statut = 'close',
             motif_cloture = left('Réserve n° ' || x.numero || ' levée sur site (réception ' || r.reference || ')', 1000),
             close_le = now(), close_par = auth.uid(),
             hors_delai = delai is not null and coalesce(corrigee_le, now())::date > delai
       where id = n.id;
    end if;
  end if;
  perform set_config('gbs.rpc', '', true);
  return x;
end $$;
