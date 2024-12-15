import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const API_URL_BLOCKS = 'https://explorer.facet.org/api/v2/main-page/blocks';
const CONTRACT_ADDRESS = '0x4200000000000000000000000000000000000015';
const RPC_URL = 'https://mainnet.facet.org/';
const MAX_MINT_RATE = 10000000; // Maximum mint rate in gwei
const INITIAL_TARGET_FCT = 400000; // Initial target FCT for adjustment period
const BLOCKS_PER_HALVING = 2630000; // Number of blocks per halving period

const ABI = [
  {
    "inputs": [],
    "name": "fctMintPeriodL1DataGas",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "fctMintRate",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
];

function App() {
  const [forecastResults, setForecastResults] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const calculateTargetFCT = (blockHeight) => {
    const halvingPeriod = Math.floor(blockHeight / BLOCKS_PER_HALVING);
    return Math.floor(INITIAL_TARGET_FCT / Math.pow(2, halvingPeriod));
  };

  const fetchLatestBlockHeight = async () => {
    const response = await fetch(API_URL_BLOCKS);
    const data = await response.json();
    const latestBlockHeight = parseInt(data[0]?.height, 10);
    if (isNaN(latestBlockHeight)) throw new Error('Invalid block height');
    return latestBlockHeight;
  };

  const fetchContractData = async () => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

    const fctMintPeriodL1DataGas = await contract.fctMintPeriodL1DataGas();
    const fctMintRate = await contract.fctMintRate();

    const fctMintRateGwei = ethers.formatUnits(fctMintRate, 'gwei');
    // eslint-disable-next-line no-undef
    const fctMined = fctMintPeriodL1DataGas * BigInt(Math.floor(parseFloat(fctMintRateGwei) * 1e9));
    const fctMinedEther = parseFloat(ethers.formatEther(fctMined));

    return {
      fctMintedSoFar: Math.round(fctMinedEther),
      currentMintRate: Math.round(parseFloat(fctMintRateGwei))
    };
  };

  const calculateAdjustmentPrediction = async () => {
    try {
      setIsLoading(true);
      let output = 'Fetching latest block height...\n';
      const totalBlocks = await fetchLatestBlockHeight();

      const halvingPeriod = Math.floor(totalBlocks / BLOCKS_PER_HALVING);
      const targetFCT = calculateTargetFCT(totalBlocks);
      output += `Current Target FCT: ${targetFCT.toLocaleString()} (after ${halvingPeriod} halvings)\n`;

      output += 'Fetching contract data...\n';
      const contractData = await fetchContractData();

      const { fctMintedSoFar, currentMintRate } = contractData;

      // Calculate current adjustment period
      const currentPeriod = Math.floor(totalBlocks / 10000) + 1;
      const periodStartBlock = (currentPeriod - 1) * 10000;
      const periodEndBlock = periodStartBlock + 9999;
      const blocksElapsedInPeriod = totalBlocks - periodStartBlock + 1;
      const percentComplete = (blocksElapsedInPeriod / 10000) * 100;
      const blocksRemaining = 10000 - blocksElapsedInPeriod;

      const forecastedIssuance = Math.round((fctMintedSoFar / blocksElapsedInPeriod) * 10000);

      // Forecasted mint rate
      let forecastedMintRate = Math.round(
        currentMintRate * (targetFCT / forecastedIssuance)
      );

      // Apply bounds
      const upperBound = Math.min(MAX_MINT_RATE, currentMintRate * 2);
      const lowerBound = Math.round(currentMintRate * 0.5);

      if (forecastedMintRate > upperBound) {
        forecastedMintRate = upperBound;
      } else if (forecastedMintRate < lowerBound) {
        forecastedMintRate = lowerBound;
      }

      const changeInMintRatePercent = ((forecastedMintRate - currentMintRate) / currentMintRate) * 100;

      // Output results
      output += '\nAdjustment Period Stats:\n';
      output += `- Current block height: ${totalBlocks.toLocaleString()}\n`;
      output += `- Halvings occurred: ${halvingPeriod}\n`;
      output += `- Current Target FCT: ${targetFCT.toLocaleString()}\n`;
      output += `- Current mint rate: ${currentMintRate.toLocaleString()} (gwei)\n`;
      output += `- Current adjustment period: ${currentPeriod}\n`;
      output += `- Period start block: ${periodStartBlock.toLocaleString()}\n`;
      output += `- Period end block: ${periodEndBlock.toLocaleString()}\n`;
      output += `- Blocks elapsed in period: ${blocksElapsedInPeriod.toLocaleString()}\n`;
      output += `- Blocks remaining in period: ${blocksRemaining.toLocaleString()}\n`;
      output += `- Percent complete: ${percentComplete.toFixed(1)}%\n`;
      output += `- Total FCT mined: ${fctMintedSoFar.toLocaleString()} (${((fctMintedSoFar / targetFCT) * 100).toFixed(1)}% of Target)\n`;

      output += '\nPrediction:\n';
      output += `- Forecasted issuance: ${forecastedIssuance.toLocaleString()} FCT\n`;
      if (forecastedIssuance > targetFCT) {
        output += `- Over target by ${(forecastedIssuance - targetFCT).toLocaleString()} FCT\n`;
      } else {
        output += `- Under target by ${(targetFCT - forecastedIssuance).toLocaleString()} FCT\n`;
      }
      output += `- Forecasted change in mint rate: ${changeInMintRatePercent.toFixed(1)}%\n`;
      output += `- Forecasted new mint rate: ${forecastedMintRate.toLocaleString()} (gwei)\n`;

      setForecastResults(output);
    } catch (error) {
      console.error('Error in calculateAdjustmentPrediction:', error);
      setForecastResults('Error calculating adjustment prediction: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    calculateAdjustmentPrediction();
  }, []);

  return (
    <div className="App">
      <h1>
        <span style={{ fontWeight: 'bold', color: '#3F19D9' }}>F</span>
        <span style={{ color: '#9C9EA4' }}>ore</span>
        <span style={{ fontWeight: 'bold', color: '#3F19D9' }}>C</span>
        <span style={{ color: '#9C9EA4' }}>as</span>
        <span style={{ fontWeight: 'bold', color: '#3F19D9' }}>T</span>
      </h1>      <button onClick={calculateAdjustmentPrediction} disabled={isLoading}>
        {isLoading ? 'Refreshing...' : 'Refresh Forecast'}
      </button>
      <pre>{forecastResults}</pre>
    </div>
  );
}

export default App;