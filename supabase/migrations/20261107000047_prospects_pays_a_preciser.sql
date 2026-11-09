-- M1 : demandes du site au pays inconnu.
-- Le formulaire du site www.gulfbridgesourcing.com envoie ses demandes directement à l'application
-- (Worker du site → fonction gbs-demande, signée) ; « Autre pays » et la demande du modèle de rapport
-- arrivent avec le pays « ZZ » (à préciser), confiées au Hub Afrique.
-- Un prospect au pays inconnu ne devient pas client : le pays décide de la société contractante et
-- de la devise. L'équipe le précise d'abord sur la fiche du prospect.

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
