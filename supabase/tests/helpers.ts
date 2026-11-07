// Outils de test : une transaction par test, annulée à la fin ; changement
// d'identité par rôle `authenticated` + claims JWT, exactement comme PostgREST
// le fait sur Supabase. Les règles et les droits sont donc testés en base.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';

export type Db = pg.PoolClient;
const pool = new pg.Pool({
  database: process.env.PGDATABASE ?? 'gbs_test',
  user: process.env.PGUSER ?? userInfo().username,
  host: process.env.PGHOST ?? '/var/run/postgresql',
  max: 4,
});

export async function withTx(fn: (db: Db) => Promise<void>): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await fn(db);
  } finally {
    await db.query('rollback').catch(() => undefined);
    db.release();
  }
}

export async function closePool() {
  await pool.end();
}

/** Bascule sur un utilisateur (rôle authenticated). aal2 = double facteur validé. */
export async function as(db: Db, userId: string | null, aal: 'aal1' | 'aal2' = 'aal2') {
  await db.query('reset role');
  if (userId === null) {
    await db.query(`select set_config('request.jwt.claims', '', true)`);
    return;
  }
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated', aal }),
  ]);
  await db.query('set local role authenticated');
}

/** Revient en superutilisateur (préparation des données). */
export async function asRoot(db: Db) {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '', true)`);
}

export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query(sql, params);
  return r.rows[0] as T;
}

export async function rows<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}

/** Attend une erreur dont le message contient `code`. Utilise un savepoint pour garder la transaction. */
export async function expectError(db: Db, code: string, sql: string, params: unknown[] = []) {
  await db.query('savepoint sp');
  try {
    await db.query(sql, params);
  } catch (e: any) {
    await db.query('rollback to savepoint sp');
    if (!String(e.message).includes(code) && e.code !== code) {
      throw new Error(`Erreur attendue « ${code} », obtenue : ${e.message}`);
    }
    return e;
  }
  await db.query('rollback to savepoint sp');
  throw new Error(`Erreur attendue « ${code} », mais la requête a réussi : ${sql}`);
}

export interface Monde {
  ci: string; cn: string;
  admin: string; achats: string; hub: string; agentGA: string; agentCM: string; inspecteur: string;
  comptable: string; delegue: string;
  clientCI: string; clientGA: string; clientCM: string;
  fournisseur: string; compte: string; article: string; articleDanger: string;
}

async function user(db: Db, nom: string, role: string, societes: string[], extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id, `${nom.toLowerCase().replace(/\W/g, '')}@gbs.test`, { nom },
  ]);
  await db.query(
    `update public.profils set role = $2, societes = $3, pays = $4, delegue_validation = $5 where id = $1`,
    [id, role, societes, extra.pays ?? null, extra.delegue ?? false],
  );
  return id;
}

/** Données de base : sociétés, utilisateurs, clients, fournisseur agréé, compte vérifié, taux. */
export async function monde(db: Db): Promise<Monde> {
  await asRoot(db);
  const ci = (await one(db, `select id from public.societes where code = 'GBS_CI'`)).id;
  const cn = (await one(db, `select id from public.societes where code = 'GBS_CN'`)).id;
  await db.query(`insert into public.taux_change (devise, date_taux, taux_xof, source) values
    ('USD', '2026-01-01', 600, 'test'), ('CNY', '2026-01-01', 84, 'test')`);
  const m: Partial<Monde> = { ci, cn };
  m.admin = await user(db, 'Pamela Atokouna', 'admin', [ci, cn]);
  m.achats = await user(db, 'Zhang Hui', 'achats_chine', [cn]);
  m.hub = await user(db, 'Awa Toure', 'hub_afrique', [ci]);
  m.agentGA = await user(db, 'Agent Gabon', 'agent_pays', [cn], { pays: 'GA' });
  m.agentCM = await user(db, 'Agent Cameroun', 'agent_pays', [cn], { pays: 'CM' });
  m.inspecteur = await user(db, 'Liu Wei', 'inspecteur', []);
  m.comptable = await user(db, 'Mariam Diallo', 'comptable', [ci]);
  m.delegue = await user(db, 'Second Validateur', 'achats_chine', [cn], { delegue: true });

  m.clientCI = (await one(db, `insert into public.clients (societe_id, raison_sociale, pays, devise, verification_statut, verification_date)
    values ($1, 'Hôtel Lagune Assinie', 'CI', 'XOF', 'verifie', current_date - 10) returning id`, [ci])).id;
  m.clientGA = (await one(db, `insert into public.clients (societe_id, raison_sociale, pays, devise, origine, agent_id)
    values ($1, 'Base-vie Moanda', 'GA', 'XAF', 'agent_pays', $2) returning id`, [cn, m.agentGA])).id;
  m.clientCM = (await one(db, `insert into public.clients (societe_id, raison_sociale, pays, devise, origine, agent_id)
    values ($1, 'Opérateur Douala', 'CM', 'XAF', 'agent_pays', $2) returning id`, [cn, m.agentCM])).id;

  m.fournisseur = await fournisseurAgree(db, m as Monde, 'Foshan Ceramics Co.');
  m.compte = await compteVerifie(db, m as Monde, m.fournisseur, 'banque', 'USD');
  m.article = (await one(db, `insert into public.articles (reference, designation, categorie, code_sh, poids_kg, volume_m3)
    values ('CER-6060', 'Carrelage grès cérame 60x60', 'Revêtements', '690721', 22, 0.03) returning id`)).id;
  m.articleDanger = (await one(db, `insert into public.articles (reference, designation, categorie, code_sh, dangereux, classe_danger, certificats)
    values ('BAT-LI-100', 'Batterie lithium 100 Ah', 'Énergie', '850760', true, '9', '{UN38.3}') returning id`)).id;
  await asRoot(db);
  return m as Monde;
}

export async function fournisseurAgree(db: Db, m: Monde, nom: string) {
  await as(db, m.achats);
  const f = (await one(db, `insert into public.fournisseurs (raison_sociale_en, raison_sociale_zh, uscc, engagement_non_commission_le, categories)
    values ($1, '佛山陶瓷', '91440600MA4UXXXX1X', current_date - 30, '{Revêtements}') returning id`, [nom])).id;
  const dd = (await one(db, `insert into public.due_diligences (fournisseur_id, grille, realisee_le)
    values ($1, '[{"critere":"Existence légale","poids":30,"note":5},{"critere":"Capacité","poids":70,"note":4}]', current_date - 20)
    returning id`, [f])).id;
  await as(db, m.admin);
  await db.query(`select public.valider_due_diligence($1, 'validee', 'Conforme')`, [dd]);
  await db.query(`select public.agreer_fournisseur($1)`, [f]);
  await asRoot(db);
  return f as string;
}

export async function compteVerifie(db: Db, m: Monde, fournisseur: string, type: string, devise: string) {
  await as(db, m.achats);
  const c = (await one(db, `insert into public.comptes_paiement (fournisseur_id, type, titulaire, devise, banque, numero)
    values ($1, $2, 'Foshan Ceramics Co. Ltd', $3, 'Bank of China', '6217000000001') returning id`, [fournisseur, type, devise])).id;
  await db.query(`select public.demander_verification_compte($1)`, [c]);
  await as(db, m.admin);
  await db.query(`select public.verifier_compte($1)`, [c]);
  await asRoot(db);
  return c as string;
}

/** Dossier d'achat accompagné ivoirien ouvert par le Hub. */
export async function dossier(db: Db, m: Monde, opts: { client?: string; societe?: string; modele?: string; by?: string;
  extra?: Record<string, unknown> } = {}) {
  await as(db, opts.by ?? m.admin);
  const cols = ['intitule', 'societe_id', 'client_id', 'modele', 'ouvert_le'];
  const vals: unknown[] = ['Équipement hôtel', opts.societe ?? m.ci, opts.client ?? m.clientCI, opts.modele ?? 'achat_accompagne',
    (opts.extra?.ouvert_le as string) ?? '2026-06-01'];
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (k === 'ouvert_le') continue;
    cols.push(k); vals.push(v);
  }
  const d = await one(db, `insert into public.dossiers (${cols.join(',')}) values (${vals.map((_, i) => `$${i + 1}`).join(',')})
    returning id, reference`, vals);
  await asRoot(db);
  return d.id as string;
}

/** Commande avec lignes (valeurs en USD). */
export async function commande(db: Db, m: Monde, d: string, lignes: { qte: number; pu: number; sur_mesure?: boolean; reassort?: boolean;
  article?: string }[], opts: { incoterm?: string; fret?: number; assurance?: number; frais?: number; fournisseur?: string } = {}) {
  await as(db, m.achats);
  const c = (await one(db, `insert into public.commandes (dossier_id, fournisseur_id, incoterm, lieu, devise, fret, assurance, frais_jusqu_a_bord)
    values ($1, $2, $3, 'Shenzhen', 'USD', $4, $5, $6) returning id`,
    [d, opts.fournisseur ?? m.fournisseur, opts.incoterm ?? 'FOB', opts.fret ?? null, opts.assurance ?? null, opts.frais ?? null])).id;
  for (const l of lignes) {
    await db.query(`insert into public.lignes_commande (commande_id, article_id, quantite, prix_unitaire, sur_mesure, reassort)
      values ($1, $2, $3, $4, $5, $6)`, [c, l.article ?? m.article, l.qte, l.pu, l.sur_mesure ?? false, l.reassort ?? false]);
  }
  await asRoot(db);
  return c as string;
}

/** Devis envoyé puis mandat validé par l'administratrice. */
export async function mandatSigne(db: Db, m: Monde, d: string, signeLe = '2026-06-10') {
  const soc = (await one(db, `select societe_id from public.dossiers where id = $1`, [d])).societe_id;
  await as(db, soc === m.ci ? m.hub : m.admin);
  const v = (await one(db, `insert into public.devis (dossier_id) values ($1) returning id`, [d])).id;
  await db.query(`update public.devis set statut = 'envoye' where id = $1`, [v]);
  await as(db, m.admin);
  await db.query(`select public.valider_mandat($1, 'mandats/m.pdf', $2)`, [v, signeLe]);
  await asRoot(db);
  return v as string;
}

export async function contratSigne(db: Db, m: Monde, c: string, signeLe = '2026-06-15') {
  await as(db, m.admin);
  await db.query(`select public.valider_contrat($1, 'contrats/c.pdf', 'cachet', $2)`, [c, signeLe]);
  await asRoot(db);
}

export async function inspectionValidee(db: Db, m: Monde, c: string, defauts = { maj: 0, min: 0 }) {
  await as(db, m.achats);
  const i = (await one(db, `insert into public.inspections (commande_id, type, inspecteur_id, taille_lot, date_prevue)
    values ($1, 'avant_expedition', $2, 1200, current_date) returning id`, [c, m.inspecteur])).id;
  await as(db, m.inspecteur);
  await db.query(`update public.inspections set statut = 'realisee', date_realisee = current_date,
    defauts_majeurs = $2, defauts_mineurs = $3 where id = $1`, [i, defauts.maj, defauts.min]);
  await as(db, m.admin);
  await db.query(`select public.valider_inspection($1, 'liberation')`, [i]);
  await asRoot(db);
  return i as string;
}
