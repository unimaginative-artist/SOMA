import lab from '../server/finance/OfflineStrategyEvolutionLab.js';

const args = process.argv.slice(2);
const option = (name, position, fallback) => {
    const flag = args.find(value => value.startsWith(`--${name}=`));
    return flag ? flag.slice(name.length + 3) : (args[position] || fallback);
};

const populationSize = Number(option('population', 0, 128));
const generations = Number(option('generations', 1, 8));
const seed = option('seed', 2, 'soma-evolution-v1');
const finalHoldoutStartTimestamp = Number(option('holdout-start', 3, 0)) || null;

lab.runFromExistingReports({ populationSize, generations, seed, finalHoldoutStartTimestamp })
    .then(report => {
        console.log(JSON.stringify(report.summary, null, 2));
        console.log('Report: data/market-lab/offline-evolution-latest.json');
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
