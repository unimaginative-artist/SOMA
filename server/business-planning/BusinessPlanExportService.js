import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { recordArtifact } from '../context/ArtifactRegistry.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const safe = value => String(value || 'business-plan').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'business-plan';
const money = value => Number(value || 0);
const rowsToSheet = rows => XLSX.utils.aoa_to_sheet(rows);

function assumptionRows(job) {
    return [['Financial assumption', 'Value'], ...Object.entries(job.financialModel?.assumptions || {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])];
}

export function buildBusinessPlanWorkbook(job) {
    const workbook = XLSX.utils.book_new();
    const assumptions = rowsToSheet(assumptionRows(job));
    XLSX.utils.book_append_sheet(workbook, assumptions, 'Assumptions');

    const market = job.marketModel || {};
    XLSX.utils.book_append_sheet(workbook, rowsToSheet([
        ['MARKET SIZING', 'Value', 'Method / confidence'],
        ['TAM', money(market.tam), market.methodology?.tam || ''],
        ['SAM', money(market.sam), market.methodology?.sam || ''],
        ['SOM (Year 3)', money(market.som), market.methodology?.som || ''],
        ['Bottom-up Year 3', money(market.bottomUpYear3), market.methodology?.bottomUp || ''],
        ['Confidence', market.confidence?.score || 0, market.confidence?.basis || ''],
        [], ['INPUT', 'VALUE', 'SOURCE IDS'],
        ...Object.entries(market.assumptions || {}).filter(([key]) => key !== 'sourceRefs').map(([key, value]) => [key, value, (market.assumptions?.sourceRefs?.[key] || []).join(', ')])
    ]), 'Market Sizing');

    const pricingRows = [['Tier', 'Price', 'Materials', 'Labor', 'Fulfillment', 'Direct costs', 'Gross profit', 'Gross margin %', 'Contribution', 'Contribution margin %', 'Monthly volume']];
    for (const tier of job.pricingModel?.tiers || []) pricingRows.push([tier.name, tier.price, tier.materialCost, tier.laborCost, tier.fulfillmentCost, tier.directCosts, tier.grossProfit, tier.grossMarginPct / 100, tier.contributionProfit, tier.contributionMarginPct / 100, tier.monthlyVolume]);
    pricingRows.push([], ['Weighted average', job.pricingModel?.weightedAveragePrice || 0, '', '', '', job.pricingModel?.weightedAverageDirectCosts || 0, '', job.pricingModel?.weightedGrossMarginPct / 100, job.pricingModel?.weightedContribution || 0, '', job.pricingModel?.mixTotal || 0]);
    pricingRows.push(['CAC', job.pricingModel?.customerAcquisitionCost || 0], ['LTV', job.pricingModel?.ltv || 0], ['LTV:CAC', job.pricingModel?.ltvCacRatio || 0], ['CAC payback months', job.pricingModel?.cacPaybackMonths || 0]);
    const pricing = rowsToSheet(pricingRows);
    pricing['!cols'] = [{ wch: 28 }, ...Array.from({ length: 10 }, () => ({ wch: 16 }))];
    XLSX.utils.book_append_sheet(workbook, pricing, 'Pricing & Unit Economics');

    const proForma = [['Scenario', 'Year', 'Ending customers', 'Revenue', 'Direct costs', 'Operating costs', 'Operating profit', 'Net cash flow', 'Ending cash']];
    for (const [name, scenario] of Object.entries(job.financialModel?.scenarios || {})) for (const year of scenario.annual || []) proForma.push([name, year.year, year.endingCustomers, year.revenue, year.directCosts, year.operatingCosts, year.operatingProfit, year.netCashFlow, year.endingCash]);
    XLSX.utils.book_append_sheet(workbook, rowsToSheet(proForma), '3-Year Pro Forma');

    const monthly = [['Month', 'Customers', 'Acquired', 'Churned', 'Revenue', 'Direct costs', 'Acquisition costs', 'Operating costs', 'Operating profit', 'Ending cash']];
    for (const row of job.financialModel?.scenarios?.base?.monthly || []) monthly.push([row.month, row.customers, row.customersAcquired, row.customersChurned, row.revenue, row.directCosts, row.acquisitionCosts, row.operatingCosts, row.operatingProfit, row.endingCash]);
    XLSX.utils.book_append_sheet(workbook, rowsToSheet(monthly), 'Monthly Base Case');

    const sensitivity = [['Price factor', 'Volume factor', 'Monthly revenue', 'Monthly operating profit'], ...(job.sensitivityAnalysis?.cells || []).map(cell => [cell.priceFactor, cell.volumeFactor, cell.monthlyRevenue, cell.monthlyOperatingProfit])];
    XLSX.utils.book_append_sheet(workbook, rowsToSheet(sensitivity), 'Sensitivity');

    const evidence = [['ID', 'Category', 'Authoritative', 'Title', 'URL', 'Retrieved'], ...(job.evidence?.sources || []).map(source => [source.id, source.category, source.authoritative ? 'yes' : 'no', source.title, source.url, source.retrievedAt])];
    XLSX.utils.book_append_sheet(workbook, rowsToSheet(evidence), 'Evidence Ledger');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
const dollars = value => `$${Math.round(Number(value) || 0).toLocaleString()}`;

export function buildPitchDeckHtml(job) {
    const profile = job.profile || {}; const market = job.marketModel || {}; const base = job.financialModel?.scenarios?.base;
    const sources = (job.evidence?.sources || []).slice(0, 8);
    const slide = (title, body, eyebrow = 'SOMA · BUSINESS PLAN') => `<section><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1>${body}</section>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:13.333in 7.5in;margin:0}*{box-sizing:border-box}body{margin:0;background:#130f0b;color:#eee5d8;font-family:Arial,sans-serif}section{width:13.333in;height:7.5in;padding:.65in .8in;page-break-after:always;position:relative;background:radial-gradient(circle at 90% 5%,#493019 0,transparent 35%),#130f0b}.eyebrow{color:#d99a52;letter-spacing:.2em;font-size:12px}h1{font-family:Georgia,serif;font-size:42px;font-weight:400;margin:.25in 0}.lead{font-size:24px;line-height:1.45;max-width:10in;color:#d7cabc}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.2in}.card{border:1px solid #564534;padding:.22in;border-radius:8px;background:#1d1711}.metric{font-size:30px;color:#e6a85f}.label{color:#a99d8e;font-size:12px;text-transform:uppercase;letter-spacing:.12em}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:10px;border-bottom:1px solid #493c30}th{color:#d99a52}.small{font-size:11px;color:#a99d8e;line-height:1.5}ul{font-size:19px;line-height:1.6}</style></head><body>
    ${slide(profile.businessName || 'Business Plan', `<p class="lead">${escapeHtml(profile.concept)}</p><p class="small">Decision draft · calculated ${escapeHtml(job.financialModel?.calculatedAt || '')}</p>`, 'SOMA · FOUNDER WORKBENCH')}
    ${slide('The customer problem', `<div class="grid"><div class="card"><div class="label">Customer</div><p>${escapeHtml(profile.customer)}</p></div><div class="card"><div class="label">Problem</div><p>${escapeHtml(profile.problem)}</p></div><div class="card"><div class="label">Solution</div><p>${escapeHtml(profile.solution)}</p></div></div>`)}
    ${slide('Evidence-backed opportunity', `<div class="grid"><div class="card"><div class="label">TAM</div><div class="metric">${dollars(market.tam)}</div></div><div class="card"><div class="label">SAM</div><div class="metric">${dollars(market.sam)}</div></div><div class="card"><div class="label">Year-3 SOM</div><div class="metric">${dollars(market.som)}</div></div></div><p class="small">Confidence ${market.confidence?.score || 0}% · ${escapeHtml(market.confidence?.label || '')}. ${escapeHtml(market.confidence?.basis || '')}</p>`)}
    ${slide('Pricing and unit economics', `<table><tr><th>Tier</th><th>Price</th><th>Gross margin</th><th>Contribution</th><th>Volume mix</th></tr>${(job.pricingModel?.tiers || []).map(tier => `<tr><td>${escapeHtml(tier.name)}</td><td>${dollars(tier.price)}</td><td>${tier.grossMarginPct}%</td><td>${dollars(tier.contributionProfit)}</td><td>${tier.monthlyVolume}</td></tr>`).join('')}</table><p class="small">LTV ${dollars(job.pricingModel?.ltv)} · CAC ${dollars(job.pricingModel?.customerAcquisitionCost)} · ratio ${job.pricingModel?.ltvCacRatio || 'n/a'}×</p>`)}
    ${slide('Three-year base case', `<div class="grid">${(base?.annual || []).map(year => `<div class="card"><div class="label">Year ${year.year}</div><div class="metric">${dollars(year.revenue)}</div><p>Operating profit ${dollars(year.operatingProfit)}<br>Ending cash ${dollars(year.endingCash)}</p></div>`).join('')}</div><p class="small">Deterministic founder-assumption model. Break-even ${base?.breakEvenMonth ? `month ${base.breakEvenMonth}` : 'not reached within 36 months'}.</p>`)}
    ${slide('Execution plan', `<div class="grid">${(job.operatingWorkspace?.milestones || []).slice(0, 4).map(item => `<div class="card"><div class="label">${escapeHtml(item.due)}</div><p>${escapeHtml(item.title)}</p></div>`).join('')}</div>`)}
    ${slide('Evidence and next decisions', `<ul>${(job.operatingWorkspace?.decisions || []).slice(0, 4).map(item => `<li>${escapeHtml(item.title)}</li>`).join('')}</ul><div class="small">${sources.map(source => `${escapeHtml(source.id)} · ${escapeHtml(source.title)} · ${escapeHtml(source.url)}`).join('<br>')}</div>`)}
    </body></html>`;
}

export class BusinessPlanExportService {
    constructor(options = {}) { this.baseDir = options.baseDir || path.join(process.cwd(), 'SOMA', 'business-plans', 'exports'); }
    async export(job, format, ownerId = 'local-owner') {
        const ownerDir = path.join(this.baseDir, safe(ownerId)); await fs.mkdir(ownerDir, { recursive: true });
        const stem = `${safe(job.profile?.businessName)}-${safe(job.id)}`;
        let buffer; let extension; let mimeType;
        if (format === 'xlsx') { buffer = buildBusinessPlanWorkbook(job); extension = 'xlsx'; mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
        else if (format === 'pdf') {
            const puppeteer = (await import('puppeteer')).default; const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            try { const page = await browser.newPage(); await page.setContent(buildPitchDeckHtml(job), { waitUntil: 'networkidle0' }); buffer = Buffer.from(await page.pdf({ printBackground: true, landscape: true, width: '13.333in', height: '7.5in', margin: { top:0, right:0, bottom:0, left:0 } })); }
            finally { await browser.close(); }
            extension = 'pdf'; mimeType = 'application/pdf';
        } else throw new Error('Unsupported business-plan export format');
        const filePath = path.join(ownerDir, `${stem}.${extension}`); await fs.writeFile(filePath, buffer);
        const artifact = await recordArtifact({ type: `business_plan_${extension}`, title: `${job.profile?.businessName || 'Business Plan'} ${extension.toUpperCase()} export`, status: 'generated', confidence: 1, evidencePath: path.relative(process.cwd(), filePath).replace(/\\/g, '/'), summary: `Owner-scoped export from business-plan job ${job.id}.`, tags: ['business-plan', extension, 'muse'] });
        return { buffer, filePath, filename: path.basename(filePath), mimeType, artifact };
    }
}

export default BusinessPlanExportService;
