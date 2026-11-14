// Fiche fournisseur · performance (M4, lot 2) : livraison complète et à l'heure, défauts en parties par million,
// réponse aux cotations, non-conformités ouvertes. Chiffres calculés par la base ; l'alerte ne change jamais
// le statut d'agrément (décision de l'administratrice).
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { date, nombre, pourcent } from '../lib/format';
import { lirePerformances } from '../lib/performance';
import { useAsync } from '../lib/data';
import { Bandeau, Chargement, Kpis, Vide } from '../components/ui';

export function PerformanceFournisseur({ fournisseurId }: { fournisseurId: string }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const p = useAsync(async () => {
    const r = await lirePerformances(fournisseurId);
    if (r.erreur) throw new Error(r.erreur);
    return r.rows[0] ?? null;
  }, [fournisseurId]);
  if (p.chargement && !p.data) return <Chargement />;
  if (p.erreur) return <Bandeau type="err">{p.erreur}</Bandeau>;
  const x = p.data;
  if (!x) return <Vide>{t('performance.indisponible')}</Vide>;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {x.en_alerte && <Bandeau>{t('performance.alerte', { motifs: x.motifs_alerte.map((m) => t(`performance.motifs.${m}`)).join(', ') })}</Bandeau>}
      <div className="mute">{t('performance.fenetre', { du: date(x.fenetre_du, langue) })}</div>
      <Kpis items={[
        { lib: t('performance.otif'), val: x.taux_otif === null ? '—' : pourcent(x.taux_otif, langue, 0),
          sous: x.livraisons === 0 ? t('performance.aucune_livraison')
            : t('performance.otif_sous', { otif: x.otif, n: x.livraisons, heure: x.a_l_heure, completes: x.completes }) },
        { lib: t('performance.ppm'), val: x.ppm === null ? '—' : nombre(x.ppm, langue),
          sous: x.inspections === 0 ? t('performance.aucune_inspection')
            : t('performance.ppm_sous', { defauts: x.defauts, unites: nombre(x.unites_inspectees, langue), n: x.inspections }) },
        { lib: t('performance.reponse'), val: x.taux_reponse === null ? '—' : pourcent(x.taux_reponse, langue, 0),
          sous: x.invitations === 0 ? t('performance.aucune_invitation')
            : t('performance.reponse_sous', { r: x.reponses, n: x.invitations, h: x.delai_reponse_heures === null ? '—' : nombre(x.delai_reponse_heures, langue, 1) }) },
        { lib: t('performance.nc'), val: x.nc_ouvertes, sous: t('performance.nc_sous', { n: x.nc_critiques_ouvertes }) },
      ]} />
      {x.retard_moyen_jours !== null && <div className="sec">{t('performance.retard_moyen', { j: nombre(x.retard_moyen_jours, langue, 1) })}</div>}
      {x.livraisons > 0 && x.completes_controlees < x.livraisons &&
        <div className="mute">{t('performance.completes_non_controlees', { n: x.livraisons - x.completes_controlees })}</div>}
      <details className="mute">
        <summary>{t('performance.definitions')}</summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {(['otif', 'ppm', 'reponse', 'nc'] as const).map((k) => <li key={k}>{t(`performance.def.${k}`)}</li>)}
        </ul>
      </details>
    </section>
  );
}
