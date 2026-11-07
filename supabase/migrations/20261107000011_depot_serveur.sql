-- Les fichiers ne s'écrivent plus directement depuis le navigateur : la fonction
-- serveur « depot » vérifie le type réel sur les octets, la taille et les droits,
-- puis écrit avec la clé de service. Les utilisateurs gardent la lecture par URL signée.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists gbs_docs_depot on storage.objects';
  end if;
end $$;
