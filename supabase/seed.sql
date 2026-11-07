-- Données FICTIVES pour l'environnement de recette uniquement (section 10 bis :
-- aucune donnée réelle hors production). Ne jamais exécuter en production.
-- Les utilisateurs se créent par Supabase Auth ; voir README, « Premier compte ».

insert into public.taux_change (devise, date_taux, taux_xof, source) values
  ('USD', date '2026-01-01', 600, 'Recette — cours fictif'),
  ('CNY', date '2026-01-01', 84, 'Recette — cours fictif')
on conflict do nothing;

insert into public.clients (societe_id, raison_sociale, pays, devise, segment, specialite, conditions_paiement)
select s.id, x.nom, x.pays, x.devise, x.segment, x.specialite, '50 % à la commande, 50 % avant départ'
from public.societes s
cross join (values
  ('Hôtel Lagune Assinie (fictif)', 'CI', 'XOF', 'Immobilier commercial et hôtelier', 'equipement_site'),
  ('Résidence Les Cocotiers (fictif)', 'CI', 'XOF', 'Promotion immobilière résidentielle', 'equipement_site'),
  ('Clinique du Plateau (fictif)', 'CI', 'XOF', 'Éducation et santé', 'autre')
) as x(nom, pays, devise, segment, specialite)
where s.code = 'GBS_CI';

insert into public.clients (societe_id, raison_sociale, pays, devise, segment, specialite)
select s.id, x.nom, x.pays, 'XAF', x.segment, 'approvisionnement_industriel'
from public.societes s
cross join (values
  ('Base-vie Moanda (fictif)', 'GA', 'Bases-vie et sites industriels'),
  ('Opérateur pétrolier Douala (fictif)', 'CM', 'Oil & Gas')
) as x(nom, pays, segment)
where s.code = 'GBS_CN';

insert into public.fournisseurs (raison_sociale_en, raison_sociale_zh, ville, categories, engagement_non_commission_le) values
  ('Foshan Ceramics Co. (fictif)', '佛山陶瓷（虚构）', 'Foshan', '{Revêtements}', current_date - 30),
  ('Guangzhou Hotel Furniture (fictif)', '广州酒店家具（虚构）', 'Guangzhou', '{Mobilier}', current_date - 20),
  ('Ningbo Power Systems (fictif)', '宁波电力系统（虚构）', 'Ningbo', '{Groupes électrogènes}', null);

insert into public.articles (reference, designation, designation_zh, categorie, code_sh, poids_kg, volume_m3) values
  ('CER-6060', 'Carrelage grès cérame 60x60', '瓷质砖 60x60', 'Revêtements', '690721', 22, 0.03),
  ('LIT-160', 'Lit hôtelier 160x200', '酒店床 160x200', 'Mobilier', '940350', 85, 0.9),
  ('GE-100', 'Groupe électrogène 100 kVA', '100 kVA 发电机组', 'Énergie', '850213', 1350, 4.2)
on conflict do nothing;
insert into public.articles (reference, designation, categorie, code_sh, dangereux, classe_danger, certificats) values
  ('BAT-LI-100', 'Batterie lithium 100 Ah', 'Énergie', '850760', true, '9', '{UN38.3}')
on conflict do nothing;
