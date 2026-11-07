-- Dépôt des fichiers : la fonction serveur « depot » vérifie le type réel sur les octets,
-- la taille et les droits, puis écrit avec la clé de service. Aucune politique
-- d'écriture n'existe sur le bucket « gbs-documents » : les utilisateurs n'ont que la
-- lecture par URL signée (politique gbs_docs_lecture, migration de configuration).
comment on function gbs_private.document_visible(text, text) is
  'Lecture des documents GBS : bucket gbs-documents et dossier visible par l''utilisateur.';
