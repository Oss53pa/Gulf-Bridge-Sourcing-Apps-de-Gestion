// Lot 1, M14 niveau 1 : page de suivi du client par lien sécurisé.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function service(db: Db) {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
}
async function lien(db: Db, m: Monde, d: string, jours = 30) {
  await as(db, m.hub);
  return (await one(db, `select gbs.creer_lien_suivi($1, 'Direction de l''hôtel', $2) r`, [d, jours])).r as { id: string; jeton: string };
}
const suivre = async (db: Db, jeton: string) => { await service(db); return (await one(db, `select gbs.suivi_client($1) r`, [jeton])).r; };

describe('Page de suivi client', () => {
  it('le jeton n’est remis qu’une fois et seule son empreinte est stockée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const l = await lien(db, m, d);
    expect(l.jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await asRoot(db);
    const stocke = await one(db, `select empreinte from gbs.liens_suivi where id = $1`, [l.id]);
    expect(stocke.empreinte).not.toContain(l.jeton);
    expect(stocke.empreinte).toBe((await one(db, `select gbs_private.empreinte_jeton($1) e`, [l.jeton])).e);
    // L'équipe voit le lien, jamais l'empreinte.
    await as(db, m.hub);
    expect(await rows(db, `select destinataire from gbs.liens_suivi where id = $1`, [l.id])).toEqual([{ destinataire: 'Direction de l\'hôtel' }]);
    await expectError(db, '42501', `select empreinte from gbs.liens_suivi`);
  }));

  it('lecture réservée au rôle de service ; lien inconnu, expiré ou révoqué refusé de la même façon', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const l = await lien(db, m, d);
    await as(db, m.admin);
    await expectError(db, '42501', `select gbs.suivi_client($1)`, [l.jeton]); // pas même exécutable
    await service(db);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.suivi_client($1)`, ['x'.repeat(43)]);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.suivi_client($1)`, ['<script>']);
    expect((await suivre(db, l.jeton)).dossier.reference).toMatch(/^GBS-/);
    await as(db, m.hub);
    await db.query(`select gbs.revoquer_lien_suivi($1)`, [l.id]);
    await service(db);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.suivi_client($1)`, [l.jeton]);
    const l2 = await lien(db, m, d);
    await asRoot(db);
    await db.query(`update gbs.liens_suivi set expire_le = now() - interval '1 second' where id = $1`, [l2.id]);
    await service(db);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.suivi_client($1)`, [l2.jeton]);
  }));

  it('durée bornée, droits de création et plafond de consultations par heure', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.hub);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.creer_lien_suivi($1, 'Client', 91)`, [d]);
    await as(db, m.achats);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.creer_lien_suivi($1, 'Client', 30)`, [d]);
    await as(db, m.admin);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet) values ('suivi.consultations_max_heure', '3', current_date)`);
    const l = await lien(db, m, d);
    for (let i = 0; i < 3; i++) await suivre(db, l.jeton);
    await expectError(db, 'GBS_TROP_DE_CONSULTATIONS', `select gbs.suivi_client($1)`, [l.jeton]);
    await asRoot(db);
    expect((await one(db, `select consultations from gbs.liens_suivi_consultations where lien_id = $1`, [l.id])).consultations).toBe(3);
    // Les consultations n'inondent pas le journal d'audit.
    expect((await one(db, `select count(*)::int n from gbs.journal_audit where table_nom = 'liens_suivi'`)).n).toBe(1);
  }));

  it('ne livre que la liste blanche : ni prix fournisseur, ni marge, ni commission', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await commande(db, m, d, [{ qte: 1000, pu: 10 }]);
    await asRoot(db);
    await db.query(`insert into gbs.points_bloquants (dossier_id, description, categorie, echeance, visible_client) values
      ($1, 'Plan validé attendu', 'client', current_date, true), ($1, 'Négociation interne du prix', 'interne', current_date, false)`, [d]);
    const l = await lien(db, m, d);
    const r = await suivre(db, l.jeton);
    expect(Object.keys(r).sort()).toEqual(['client', 'documents', 'dossier', 'expeditions', 'expire_le', 'factures',
      'ouverture', 'phases', 'pieces_attendues', 'points_bloquants']);
    const texte = JSON.stringify(r);
    for (const interdit of ['prix_unitaire', 'montant_marchandise', 'fob', 'marge', 'commission', 'fournisseur_id', 'Foshan']) {
      expect(texte).not.toContain(interdit);
    }
    expect(r.points_bloquants).toEqual([expect.objectContaining({ description: 'Plan validé attendu' })]);
    expect(r.phases[0]).toMatchObject({ phase: 'consultation', statut: 'en_cours' });
  }));

  it('documents : seulement les pièces validées autorisées ; en négoce, jamais la facture du fabricant', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await asRoot(db);
    await db.query(`insert into gbs.pieces (dossier_id, phase, code, libelle, statut, document_chemin) values
      ($1, 'inspection', 'certificat_inspection_x', 'Hors liste', 'manquante', null)`, [d]);
    await db.query(`select set_config('gbs.rpc', 'systeme', true)`);
    await db.query(`update gbs.pieces set statut = 'validee', document_chemin = $1 || '/11111111-1111-4111-8111-111111111111.pdf'
                     where dossier_id = $1 and code in ('certificat_inspection', 'facture_commerciale', 'grille_analyse')`, [d]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    const l = await lien(db, m, d);
    const libelles = (await suivre(db, l.jeton)).documents.map((x: any) => x.libelle).sort();
    expect(libelles).toEqual(['Certificat d\'inspection', 'Facture commerciale']);
    expect(await one(db, `select gbs_private.piece_visible_client('facture_commerciale', 'negoce') v`)).toEqual({ v: false });
    expect(await one(db, `select gbs_private.piece_visible_client('grille_analyse', 'accompagne') v`)).toEqual({ v: false });
  }));
});
