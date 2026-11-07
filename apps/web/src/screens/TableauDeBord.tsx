import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ok, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { compact, date } from '../lib/format';
import type { PointBloquant, TableauDeBord as TDB } from '../lib/types';
import { Bandeau, CadreTableau, Chargement, Entete, Kpis, Onglets, Statut, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';

export function TableauDeBord() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profil, societeActive, langue, societes } = useAuth();
  const [onglet, setOnglet] = useState<'synthese' | 'arbitrer'>('synthese');
  const dossiers = useNoms('dossiers');
  const { data, erreur } = useAsync(async () => ok(await supabase.rpc('tableau_de_bord', { p_societe: societeActive })) as TDB, [societeActive]);
  const points = useAsync(async () => ok(await supabase.from('points_bloquants').select('*').is('resolu_le', null)
    .order('echeance').limit(50)) as PointBloquant[], []);
  const cadres = useAsync(async () => (['admin', 'hub_afrique', 'agent_pays', 'comptable'].includes(profil?.role ?? '')
    ? ok(await supabase.rpc('cadres_a_echeance')) as { dossier_id: string; reference: string; client: string; cadre_fin: string; jours_restants: number }[]
    : []), [profil?.role]);
  const societe = societes.find((s) => s.id === societeActive);
  const masque = data && !data.montants_visibles;
  const m = (v: number | null | undefined) => (masque || v === null || v === undefined ? '•••' : compact(v, langue));

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.pilotage')} · ${societe ? societe.raison_sociale : t('coque.consolide')}`}
        titre={t('tableau.bonjour', { nom: profil?.nom.split(' ')[0] ?? '' })}
        actions={<><Link className="btn" to="/dossiers">{t('ecrans.portefeuille')}</Link></>} />
      <Bandeau type="err">{erreur}</Bandeau>
      {!data ? <Chargement /> : (
        <>
          <Kpis items={[
            { lib: t('tableau.ca_mois'), val: m(data.ca_mois_xof), sous: 'XOF HT' },
            { lib: t('tableau.a_encaisser'), val: m(data.a_encaisser_xof), sous: t('tableau.en_retard', { n: data.factures_en_retard }) },
            { lib: t('tableau.fob_production'), val: data.fob_en_production_xof === null ? '•••' : compact(data.fob_en_production_xof, langue),
              sous: t('tableau.commandes_production', { n: data.commandes_en_production }) },
            { lib: t('tableau.dossiers_ouverts'), val: data.dossiers_ouverts, sous: t('tableau.pieces_manquantes', { n: data.pieces_manquantes }) },
          ]} />
          <Onglets actif={onglet} onChange={setOnglet} items={[
            { id: 'synthese', lib: t('tableau.synthese') },
            { id: 'arbitrer', lib: `${t('tableau.a_arbitrer')} · ${data.points_bloquants_escalades + data.fne_en_attente + (data.paiements_a_valider ?? 0)}` },
          ]} />
          {onglet === 'synthese' ? (
            <Kpis items={[
              { lib: t('tableau.points_bloquants'), val: data.points_bloquants_ouverts, sous: t('tableau.escalades', { n: data.points_bloquants_escalades }) },
              { lib: t('tableau.fne_attente'), val: data.fne_en_attente, sous: t('tableau.fne_sous') },
              { lib: t('tableau.paiements_valider'), val: data.paiements_a_valider ?? '—', sous: t('tableau.quatre_yeux') },
              { lib: t('tableau.dd_expirant'), val: data.dd_expirant_60j ?? '—', sous: t('tableau.dd_sous') },
            ]} />
          ) : null}
          {(cadres.data ?? []).length > 0 && (
            <Bandeau>{t('tableau.cadres_echeance', { liste: (cadres.data ?? []).map((c) => `${c.reference} · ${c.client} (${t('tableau.jours', { n: c.jours_restants })})`).join(' ; ') })}</Bandeau>
          )}
          <CadreTableau titre={t('tableau.points_ouverts')}>
            {points.chargement ? <Chargement /> : (points.data ?? []).length === 0 ? <Vide>{t('tableau.aucun_point')}</Vide> : (
              <table className="t">
                <thead><tr><th>{t('champs.dossier')}</th><th>{t('champs.description')}</th><th>{t('champs.categorie')}</th>
                  <th>{t('champs.echeance')}</th><th>{t('champs.statut')}</th></tr></thead>
                <tbody>
                  {(points.data ?? []).map((p) => (
                    <tr key={p.id} className="cliquable" onClick={() => nav(`/dossiers/${p.dossier_id}`)}>
                      <td className="ref">{dossiers[p.dossier_id] ?? '…'}</td>
                      <td>{p.description}</td>
                      <td className="sec">{t(`categories.${p.categorie}`)}</td>
                      <td className="ref">{date(p.echeance, langue)}</td>
                      <td>{p.escalade_le ? <Statut statut="bloquee" libelle={t('tableau.escalade')} /> : <Statut statut="ouverte" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CadreTableau>
        </>
      )}
    </div>
  );
}
