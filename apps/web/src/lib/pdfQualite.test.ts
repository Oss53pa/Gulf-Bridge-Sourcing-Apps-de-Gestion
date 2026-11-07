import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { assemblerDossierQualite, texteSur } from './pdfQualite';

const libelles = { sommaire: 'Sommaire', manquant: 'Manquant', present: 'Présent', annexe: 'Annexe', page: 'Page' };

describe('dossier qualité en PDF', () => {
  it('texte sûr pour les polices standard : accents gardés, hors WinAnsi remplacés, contrôles retirés', () => {
    expect(texteSur('Réception – « conforme » €')).toBe('Réception – « conforme » €');
    expect(texteSur('质量 ok')).toBe('?? ok');
    expect(texteSur('a\u0000b\u0007c')).toBe('abc');
  });

  it('garde, sommaire, sections et pièces jointes recopiées', async () => {
    const annexe = await PDFDocument.create();
    annexe.addPage(); annexe.addPage();
    const octets = await annexe.save();
    const pdf = await assemblerDossierQualite({
      titre: 'Dossier qualité DOS-2026-001', sousTitre: ['Hôtel Lagune', 'Référentiel QHSE-07'], libelles,
      sections: [
        { code: 'rapports_inspection', titre: 'Rapports d’inspection', obligatoire: true, present: true, lignes: ['INS-2026-001 · libéré · 1 200 unités'] },
        { code: 'tracabilite', titre: 'Traçabilité', obligatoire: true, present: false, lignes: [] },
      ],
    }, [{ section: 'rapports_inspection', titre: 'INS-2026-001', octets, type: 'pdf' }]);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const relu = await PDFDocument.load(pdf);
    expect(relu.getPageCount()).toBe(1 + 1 + 1 + 2 + 1);   // garde, sommaire, section 1, 2 pages jointes, section 2
  });
});
