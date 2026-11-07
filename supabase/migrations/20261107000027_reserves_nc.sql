-- Lot 1, M28 → M27 : une réserve majeure ou bloquante imputée au fournisseur ouvre, à la
-- signature du procès-verbal (accepté ou refusé), une non-conformité sur sa commande ;
-- elle compte dans la note qualité du fournisseur. Majeure → majeur, bloquante → critique.
-- La commande est celle de la réserve, ou la seule commande du dossier ; si le dossier en a
-- plusieurs, la signature est refusée tant que la commande n'est pas précisée ; s'il n'en a
-- aucune, il n'y a pas de fournisseur à qui imputer la réserve.

alter table gbs.reserves_reception add column non_conformite_id uuid references gbs.non_conformites(id);

create or replace function gbs.signer_reception(p_reception uuid, p_decision text, p_signataire text, p_document text, p_signe_le date)
returns gbs.receptions language plpgsql security definer set search_path = '' as $$
declare r gbs.receptions; sig text := trim(coalesce(p_signataire, '')); nb int; bloquantes int;
        x gbs.reserves_reception; cmd uuid; nc uuid; seule uuid; ncmd int;
begin
  select * into r from gbs.receptions where id = p_reception for update;
  perform gbs_private.exiger(r.id is not null and gbs_private.peut_receptionner(r.dossier_id));
  if r.statut <> 'brouillon' then raise exception 'GBS_RECEPTION_STATUT' using errcode = 'P0001'; end if;
  if p_decision not in ('acceptee','refusee') or length(sig) not between 2 and 120
     or p_document is null or not gbs_private.photos_valides(r.dossier_id, array[p_document])
     or p_signe_le is null or p_signe_le > current_date or p_signe_le < r.date_reception then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select count(*), count(*) filter (where gravite = 'bloquante') into nb, bloquantes
    from gbs.reserves_reception where reception_id = p_reception;
  if p_decision = 'acceptee' and bloquantes > 0 then
    raise exception 'GBS_RESERVE_BLOQUANTE: une réserve bloquante interdit l''acceptation' using errcode = 'P0001';
  end if;
  if p_decision = 'refusee' and nb = 0 then
    raise exception 'GBS_REFUS_SANS_RESERVE: un refus s''appuie sur au moins une réserve' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'reception', true);
  -- Réserves imputées au fournisseur : non-conformité sur la commande concernée.
  select count(*) into ncmd from gbs.commandes c where c.dossier_id = r.dossier_id and c.statut <> 'annulee';
  if ncmd = 1 then
    select c.id into seule from gbs.commandes c where c.dossier_id = r.dossier_id and c.statut <> 'annulee';
  end if;
  for x in select * from gbs.reserves_reception where reception_id = p_reception and responsable = 'fournisseur'
             and gravite in ('majeure','bloquante') order by numero loop
    cmd := coalesce(x.commande_id, seule);
    continue when cmd is null and ncmd = 0;   -- aucune commande dans le dossier : rien à imputer
    if cmd is null then
      raise exception 'GBS_COMMANDE_REQUISE: précisez la commande de la réserve n° %', x.numero using errcode = 'P0001';
    end if;
    insert into gbs.non_conformites (dossier_id, commande_id, gravite, description, delai, photos)
    values (r.dossier_id, cmd, case x.gravite when 'bloquante' then 'critique' else 'majeur' end,
            left('Réserve n° ' || x.numero || ' à la réception ' || r.reference || ' : ' || x.description, 4000),
            case when x.delai >= current_date then x.delai end, x.photos)
    returning id into nc;
    update gbs.reserves_reception set commande_id = cmd, non_conformite_id = nc where id = x.id;
  end loop;
  update gbs.receptions set client_signataire = sig, pv_document = p_document, signe_le = p_signe_le,
         statut = case when p_decision = 'refusee' then 'refusee' when nb = 0 then 'definitive' else 'signee' end,
         definitive_le = case when p_decision = 'acceptee' and nb = 0 then p_signe_le end
   where id = p_reception returning * into r;
  perform set_config('gbs.rpc', '', true);
  if r.statut <> 'refusee' then perform gbs_private.maj_piece_reception(r.dossier_id, p_document); end if;
  return r;
end $$;
