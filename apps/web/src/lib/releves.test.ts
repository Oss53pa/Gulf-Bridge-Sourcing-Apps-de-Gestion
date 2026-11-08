import { describe, expect, it } from 'vitest';
import { centimes, formatReleve, lireCamt053, lireMt940, lireTableur, ReleveIllisible } from './releves';

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
  <Id>REL-2026-10</Id><FrToDt><FrDtTm>2026-10-01T00:00:00</FrDtTm><ToDtTm>2026-10-31T23:59:59</ToDtTm></FrToDt>
  <Acct><Id><IBAN>CI93 CI00 1001 0000 0000 0001</IBAN></Id><Ccy>XOF</Ccy></Acct>
  <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="XOF">1000000</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-01</Dt></Dt></Bal>
  <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="XOF">2177500</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-31</Dt></Dt></Bal>
  <Ntry><Amt Ccy="XOF">1180000</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-12</Dt></BookgDt><ValDt><Dt>2026-10-13</Dt></ValDt>
    <AcctSvcrRef>BQ-0001</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>HOTEL LAGUNE</Nm></Dbtr></RltdPties><RmtInf><Ustrd>VIR-HLA-2026-41</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="XOF">2500</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-15</Dt></BookgDt><AcctSvcrRef>BQ-0002</AcctSvcrRef><AddtlNtryInf>COMMISSION TENUE DE COMPTE</AddtlNtryInf></Ntry>
  <Ntry><Amt Ccy="XOF">999</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-10-30</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

const MT940 = `{1:F01BANKCIABXXXX0000000000}{2:I940BANKCIABXXXXN}{4:
:20:REL2610
:25:CI0010010000000001
:28C:00010/001
:60F:C261001XOF1000000,
:61:2610121012C1180000,NTRFVIR-HLA-2026-41//BQ-0001
:86:VIR RECU HOTEL LAGUNE
:61:261015D2500,NCHGNONREF//BQ-0002
:86:COMMISSION?20TENUE DE COMPTE
:62F:C261031XOF2177500,
-}`;

describe('relevés bancaires', () => {
  it('montants en centimes, sans arrondi', () => {
    expect(centimes('1 234,56')).toBe(123456);
    expect(centimes('-0.1')).toBe(-10);
    expect(() => centimes('12,345')).toThrow(ReleveIllisible);
    expect(() => centimes('1e5')).toThrow(ReleveIllisible);
  });

  it('camt.053 : soldes, opérations comptabilisées seulement, références', () => {
    const r = lireCamt053(CAMT);
    expect([r.compte, r.devise, r.debut, r.fin, r.ouverture, r.cloture]).toEqual(['CI93CI001001000000000001', 'XOF', '2026-10-01', '2026-10-31', 1000000, 2177500]);
    expect(r.lignes.map((l) => [l.date_operation, l.montant, l.reference])).toEqual([['2026-10-12', 1180000, 'BQ-0001'], ['2026-10-15', -2500, 'BQ-0002']]);
    expect(r.lignes[0]).toMatchObject({ contrepartie: 'HOTEL LAGUNE', date_valeur: '2026-10-13' });
    expect(r.lignes[0].libelle).toContain('VIR-HLA-2026-41');
  });

  it('camt.053 : entités XML et relevé déséquilibré refusés', () => {
    expect(() => lireCamt053('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Document/>')).toThrow(ReleveIllisible);
    expect(() => lireCamt053(CAMT.replace('2177500', '2177501'))).toThrow(/déséquilibré/);
  });

  it('MT940 : soldes :60F: / :62F:, opérations :61: et libellés :86:', () => {
    const r = lireMt940(MT940);
    expect([r.compte, r.devise, r.ouverture, r.cloture, r.debut, r.fin]).toEqual(['CI0010010000000001', 'XOF', 1000000, 2177500, '2026-10-01', '2026-10-31']);
    expect(r.lignes.map((l) => [l.date_operation, l.montant, l.reference, l.libelle])).toEqual([
      ['2026-10-12', 1180000, 'BQ-0001', 'VIR RECU HOTEL LAGUNE'], ['2026-10-15', -2500, 'BQ-0002', 'COMMISSION TENUE DE COMPTE']]);
  });

  it('tableur : en-tête, guillemets, dates françaises, soldes saisis', () => {
    const csv = 'Date;Libellé;Montant;Référence\n12/10/2026;"VIR ""HLA"" ; octobre";1 180 000;BQ-1\n2026-10-15;Frais;-2500,00;';
    const r = lireTableur(csv, 1000000, 2177500);
    expect(r.lignes.map((l) => [l.date_operation, l.libelle, l.montant, l.reference])).toEqual([
      ['2026-10-12', 'VIR "HLA" ; octobre', 1180000, 'BQ-1'], ['2026-10-15', 'Frais', -2500, null]]);
    expect(() => lireTableur(csv, 0, 0)).toThrow(/déséquilibré/);
  });

  it('format détecté sur le contenu', () => {
    expect(formatReleve(CAMT)).toBe('camt053');
    expect(formatReleve(MT940)).toBe('mt940');
    expect(formatReleve('date;libelle;montant')).toBe('tableur');
  });
});
