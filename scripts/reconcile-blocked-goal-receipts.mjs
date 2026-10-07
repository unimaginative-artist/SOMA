import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const goalsPath = path.join(root, 'data/goals.json');

const data = JSON.parse(fs.readFileSync(goalsPath, 'utf8'));

// 1. Reconcile 65da2efc-3183-4790-9aec-01530c11321c
const id1 = '65da2efc-3183-4790-9aec-01530c11321c';
const oldReceiptPath1 = path.join(root, 'data/goal-receipts/65da2efc-3183-4790-9aec-01530c11321c-1790848639657.json');
const oldReceipt1 = JSON.parse(fs.readFileSync(oldReceiptPath1, 'utf8'));
const uuid1 = crypto.randomUUID();
const newReceiptFile1 = `65da2efc-3183-4790-9aec-01530c11321c-goal-receipt-reconciled-${uuid1}.json`;
const newReceiptPath1 = path.join(root, 'data/goal-receipts', newReceiptFile1);
const newReceipt1 = {
    schemaVersion: 1,
    receiptId: `goal-receipt-reconciled-${uuid1}`,
    goalId: id1,
    goalTitle: oldReceipt1.goalTitle,
    createdAt: new Date().toISOString(),
    lifecycleState: 'blocked',
    done: false,
    stopReason: oldReceipt1.stopReason,
    result: oldReceipt1.result,
    toolsUsed: oldReceipt1.toolsUsed || [],
    iterations: 0,
    totalIterations: 0,
    completionEvidence: null,
    toolOutcomes: [],
    priorReceiptPaths: [
        ...(oldReceipt1.priorReceiptPaths || []),
        'data/goal-receipts/65da2efc-3183-4790-9aec-01530c11321c-1790848639657.json'
    ],
    historicalToolOutcomes: oldReceipt1.historicalToolOutcomes || []
};
fs.writeFileSync(newReceiptPath1, JSON.stringify(newReceipt1, null, 2), 'utf8');
console.log('✅ Created reconciled terminal receipt:', newReceiptFile1);

// 2. Reconcile c13ba143-13f7-4133-b18c-3991181df7c3
const id2 = 'c13ba143-13f7-4133-b18c-3991181df7c3';
const oldReceiptPath2 = path.join(root, 'data/goal-receipts/c13ba143-13f7-4133-b18c-3991181df7c3-1790854366414.json');
const oldReceipt2 = JSON.parse(fs.readFileSync(oldReceiptPath2, 'utf8'));
const uuid2 = crypto.randomUUID();
const newReceiptFile2 = `c13ba143-13f7-4133-b18c-3991181df7c3-goal-receipt-reconciled-${uuid2}.json`;
const newReceiptPath2 = path.join(root, 'data/goal-receipts', newReceiptFile2);
const newReceipt2 = {
    schemaVersion: 1,
    receiptId: `goal-receipt-reconciled-${uuid2}`,
    goalId: id2,
    goalTitle: oldReceipt2.goalTitle,
    createdAt: new Date().toISOString(),
    lifecycleState: 'blocked',
    done: false,
    stopReason: oldReceipt2.stopReason,
    result: oldReceipt2.result,
    toolsUsed: oldReceipt2.toolsUsed || [],
    iterations: 0,
    totalIterations: 0,
    completionEvidence: null,
    toolOutcomes: [],
    priorReceiptPaths: [
        ...(oldReceipt2.priorReceiptPaths || []),
        'data/goal-receipts/c13ba143-13f7-4133-b18c-3991181df7c3-1790854366414.json'
    ],
    historicalToolOutcomes: oldReceipt2.historicalToolOutcomes || []
};
fs.writeFileSync(newReceiptPath2, JSON.stringify(newReceipt2, null, 2), 'utf8');
console.log('✅ Created reconciled terminal receipt:', newReceiptFile2);

// 3. Update pointers in data/goals.json strictly for verified goals that exist
if (data.goals[id1]?.metadata) {
    data.goals[id1].metadata.latestExecutionReceipt = `data/goal-receipts/${newReceiptFile1}`;
    console.log(`✅ Pointed ${id1} to ${newReceiptFile1} (attempts preserved: ${data.goals[id1].metadata.executionAttempts}/${data.goals[id1].metadata.maxAttempts})`);
}
if (data.goals[id2]?.metadata) {
    data.goals[id2].metadata.latestExecutionReceipt = `data/goal-receipts/${newReceiptFile2}`;
    console.log(`✅ Pointed ${id2} to ${newReceiptFile2} (attempts preserved: ${data.goals[id2].metadata.executionAttempts}/${data.goals[id2].metadata.maxAttempts})`);
}

fs.writeFileSync(goalsPath, JSON.stringify(data, null, 2), 'utf8');
console.log('✅ Saved data/goals.json with updated receipt pointers.');
