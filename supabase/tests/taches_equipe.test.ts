// Mes tâches · vue « Équipe » (migration 72) : réservée à l'administratrice et au Hub Afrique,
// limitée aux dossiers visibles de l'appelant ; « mes tâches » inchangée.
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, dossier, expectError, monde, rows, withTx, type Db } from './helpers';

afterAll(closePool);

async function preparer(db: Db) {
  const m = await monde(db);
  const dCI = await dossier(db, m);
  const dGA = await dossier(db, m, { client: m.clientGA, societe: m.cn });
  await as(db, m.admin);
  await db.query(`insert into gbs.taches (dossier_id, phase, libelle, assigne_a, echeance) values
    ($1, 'consultation', 'Tâche CI', $3, current_date - 1),
    ($2, 'consultation', 'Tâche Gabon', $3, current_date + 10),
    (null, null, 'Tâche sans dossier', $3, current_date + 1)`, [dCI, dGA, m.achats]);
  return { m, dCI, dGA };
}

const equipe = (db: Db) => rows(db, `select responsable, nature, libelle, urgence from gbs.taches_equipe()
  where nature = 'tache' order by libelle`);

describe('Mes tâches · vue Équipe', () => {
  it('l’administratrice voit toutes les tâches avec le nom du responsable', () => withTx(async (db) => {
    const { m } = await preparer(db);
    await as(db, m.admin);
    expect(await equipe(db)).toEqual([
      { responsable: 'Zhang Hui', nature: 'tache', libelle: 'Tâche CI', urgence: 1 },
      { responsable: 'Zhang Hui', nature: 'tache', libelle: 'Tâche Gabon', urgence: 3 },
      { responsable: 'Zhang Hui', nature: 'tache', libelle: 'Tâche sans dossier', urgence: 2 },
    ]);
  }));

  it('le Hub ne voit que les dossiers qu’il voit, jamais les tâches sans dossier', () => withTx(async (db) => {
    const { m } = await preparer(db);
    await as(db, m.hub);
    expect((await equipe(db)).map((x) => x.libelle)).toEqual(['Tâche CI']);
  }));

  it('réservée aux responsables ; « mes tâches » de l’assigné inchangée', () => withTx(async (db) => {
    const { m } = await preparer(db);
    for (const u of [m.achats, m.agentGA, m.inspecteur, m.comptable]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.taches_equipe()`);
    }
    await as(db, m.achats);
    expect((await rows(db, `select libelle from gbs.mes_taches() where nature = 'tache' order by libelle`)).map((x) => x.libelle))
      .toEqual(['Tâche CI', 'Tâche Gabon', 'Tâche sans dossier']);
    await as(db, null);
    await expectError(db, '42501', `select * from gbs.taches_equipe()`);
  }));
});
