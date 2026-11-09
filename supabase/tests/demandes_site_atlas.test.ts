// M1 : demandes du formulaire du site (console Atlas Studio) importées en prospects.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

// Réplique minimale des tables d'Atlas Studio (absentes de la base de test).
async function atlas(db: Db) {
  await asRoot(db);
  await db.query(`create table if not exists public.client_sites (id text primary key, name text not null, domain text)`);
  await db.query(`create table if not exists public.client_site_leads (id uuid primary key default gen_random_uuid(), site_id text not null,
    name text not null, company text, email text not null, phone text, service text, message text, page text,
    created_at timestamptz not null default now())`);
  await db.query(`insert into public.client_sites values ('gulf-bridge-sourcing', 'Gulf Bridge Sourcing', 'www.gulfbridgesourcing.com'),
    ('autre-site', 'Autre', 'autre.example') on conflict do nothing`);
}
async function lead(db: Db, v: Record<string, string | null>, site = 'gulf-bridge-sourcing') {
  await asRoot(db);
  return (await one(db, `insert into public.client_site_leads (site_id, name, company, email, phone, service, message, page)
    values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [site, v.name ?? 'Serge Yao', v.company ?? null, v.email ?? 'syao@akwaba.ci', v.phone ?? null, v.service ?? null, v.message ?? null, v.page ?? 'accueil'])).id as string;
}
const importer = async (db: Db) => { await asRoot(db); return Number((await one(db, `select gbs_private.importer_demandes_site() n`)).n); };

describe('Demandes du site importées depuis Atlas Studio', () => {
  it('crée le prospect : pays par indicatif, spécialité, page https, consentement, tâche de premier contact', () => withTx(async (db) => {
    const m = await monde(db);
    await atlas(db);
    const l = await lead(db, { company: 'Groupe Akwaba', phone: '+225 07 48 21 33 90', service: 'Équipement d’un hôtel', message: '220 chambres' });
    await lead(db, { email: 'x@autre.example' }, 'autre-site');
    expect(await importer(db)).toBe(1);
    const p = await one(db, `select p.raison_sociale, p.contact_nom, p.pays, p.specialite, p.source, p.page_origine, p.consentement_le is not null c,
      p.responsable_id, p.statut from gbs.demandes_site_importees i join gbs.prospects p on p.id = i.prospect_id where i.lead_id = $1`, [l]);
    expect(p).toEqual({ raison_sociale: 'Groupe Akwaba', contact_nom: 'Serge Yao', pays: 'CI', specialite: 'equipement_site', source: 'site_web',
      page_origine: 'https://www.gulfbridgesourcing.com/', c: true, responsable_id: m.hub, statut: 'nouveau' });
    expect(Number((await one(db, `select count(*) n from gbs.taches t join gbs.demandes_site_importees i on i.prospect_id = t.prospect_id where i.lead_id = $1`, [l])).n)).toBe(1);
    // Une seule importation par demande.
    expect(await importer(db)).toBe(0);
    // Les demandes des autres sites ne sont jamais reprises.
    expect(await rows(db, `select 1 from gbs.prospects where email = 'x@autre.example'`)).toEqual([]);
  }));

  it('Gabon confié à l’agent ; pays inconnu « ZZ » au Hub ; même e-mail sous 24 h rattaché', () => withTx(async (db) => {
    const m = await monde(db);
    await atlas(db);
    await lead(db, { email: 'achats@mine.ga', phone: '+241 66 00 00 00', service: 'Approvisionnement industriel' });
    await lead(db, { email: 'contact@inconnu.com', phone: null, company: null, name: 'Jean Martin' });
    await lead(db, { email: 'achats@mine.ga', message: 'Précision : 3 groupes électrogènes' });
    expect(await importer(db)).toBe(3);
    const ga = await one(db, `select id, responsable_id, agent_id, specialite from gbs.prospects where email = 'achats@mine.ga'`);
    expect([ga.responsable_id, ga.agent_id, ga.specialite]).toEqual([m.agentGA, m.agentGA, 'approvisionnement_industriel']);
    expect(Number((await one(db, `select count(*) n from gbs.prospects_actions where prospect_id = $1 and type = 'demande_site'`, [ga.id])).n)).toBe(1);
    const zz = await one(db, `select pays, raison_sociale, responsable_id from gbs.prospects where email = 'contact@inconnu.com'`);
    expect(zz).toEqual({ pays: 'ZZ', raison_sociale: 'Jean Martin', responsable_id: m.hub });
    // Visible du Hub Afrique, pas de l'agent du Gabon.
    await as(db, m.hub);
    expect((await rows(db, `select 1 from gbs.prospects where email = 'contact@inconnu.com'`)).length).toBe(1);
    await as(db, m.agentGA);
    expect(await rows(db, `select 1 from gbs.prospects where email = 'contact@inconnu.com'`)).toEqual([]);
    // Conversion refusée tant que le pays n'est pas précisé, acceptée ensuite.
    await as(db, m.hub);
    const id = (await one(db, `select id from gbs.prospects where email = 'contact@inconnu.com'`)).id;
    await db.query(`select gbs.enregistrer_action_prospect($1, 'email', current_date, 'Réponse envoyée')`, [id]);
    await expectError(db, 'GBS_PAYS_A_PRECISER', `select gbs.convertir_prospect($1)`, [id]);
    await db.query(`update gbs.prospects set pays = 'SN', specialite = 'equipement_site' where id = $1`, [id]);
    expect((await one(db, `select pays from gbs.convertir_prospect($1)`, [id])).pays).toBe('SN');
  }));

  it('demande inexploitable consignée sans être réessayée ; téléphone ou page douteux écartés ; fonction fermée', () => withTx(async (db) => {
    const m = await monde(db);
    await atlas(db);
    const mauvais = await lead(db, { email: 'pas-une-adresse', phone: null });
    const l = await lead(db, { email: 'ok@hotel.ci', phone: '<script>', page: 'javascript:alert(1)' });
    expect(await importer(db)).toBe(1);
    expect(await one(db, `select prospect_id, erreur from gbs.demandes_site_importees where lead_id = $1`, [mauvais])).toEqual({ prospect_id: null, erreur: 'GBS_DEMANDE_INVALIDE' });
    expect(await one(db, `select p.telephone, p.page_origine, p.pays from gbs.prospects p join gbs.demandes_site_importees i on i.prospect_id = p.id where i.lead_id = $1`, [l]))
      .toEqual({ telephone: null, page_origine: null, pays: 'ZZ' });
    expect(await importer(db)).toBe(0);
    for (const u of [m.admin, m.hub]) {
      await as(db, u);
      await expectError(db, '42501', `select gbs_private.importer_demandes_site()`);
      await expectError(db, '42501', `select * from gbs.demandes_site_importees`);
    }
  }));
});
