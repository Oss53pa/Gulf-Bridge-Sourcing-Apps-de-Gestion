import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import fr from './fr.json';
import en from './en.json';
import zh from './zh.json';

const plat = (o: Record<string, unknown>, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? plat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));

function fichiers(d: string): string[] {
  return readdirSync(d).flatMap((f) => { const c = join(d, f); return statSync(c).isDirectory() ? fichiers(c) : /\.tsx?$/.test(f) ? [c] : []; });
}

describe('glossaires trilingues', () => {
  const kFr = new Set(plat(fr));
  it('anglais et chinois ont exactement les clés du français', () => {
    expect(plat(en).sort()).toEqual([...kFr].sort());
    expect(plat(zh).sort()).toEqual([...kFr].sort());
  });
  it('chaque clé littérale utilisée dans le code existe en français (aucun libellé manquant)', () => {
    const manquantes: string[] = [];
    for (const f of fichiers(join(__dirname, '..'))) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\bt\(\s*'([a-z_]+\.[a-zA-Z0-9_.]+)'/g)) if (!kFr.has(m[1])) manquantes.push(`${m[1]} (${f})`);
    }
    expect(manquantes).toEqual([]);
  });
  it('chaque code d\'erreur levé par la base a son message', () => {
    const sql = readdirSync(join(__dirname, '../../../../supabase/migrations')).map((f) => readFileSync(join(__dirname, '../../../../supabase/migrations', f), 'utf8')).join('\n');
    const codes = new Set([...sql.matchAll(/raise exception '(GBS_[A-Z0-9_]+)/g)].map((m) => m[1]));
    const internes = ['GBS_BAREME_INCOMPLET', 'GBS_COMMANDE_INCONNUE', 'GBS_DOSSIER_INCONNU', 'GBS_ECHEANCE_INCONNUE', 'GBS_PAIEMENT_INCONNU',
      'GBS_PROFIL_INCONNU', 'GBS_INTRAGROUPE_INVALIDE', 'GBS_MODELE_INACTIF', 'GBS_MONTANT_INVALIDE', 'GBS_MOTIF_TROP_LONG', 'GBS_NIVEAU_INVALIDE', 'GBS_TYPE_INVALIDE'];
    const sans = [...codes].filter((c) => !kFr.has(`erreurs.${c}`) && !internes.includes(c));
    expect(sans).toEqual([]);
  });
});
