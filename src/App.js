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
  const [issuanceHistory, setIssuanceHistory] = useState([]);
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

  const fetchHistoricalData = async (blockNumber) => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

    try {
      const fctMintPeriodL1DataGas = await contract.fctMintPeriodL1DataGas({ blockTag: blockNumber });
      const fctMintRate = await contract.fctMintRate({ blockTag: blockNumber });
      
      const fctMintRateGwei = ethers.formatUnits(fctMintRate, 'gwei');
      const fctMined = fctMintPeriodL1DataGas * BigInt(Math.floor(parseFloat(fctMintRateGwei) * 1e9));
      const fctMinedEther = parseFloat(ethers.formatEther(fctMined));

      return Math.round(fctMinedEther);
    } catch (error) {
      console.error('Error fetching historical data:', error);
      return null;
    }
  };

  const calculateAdjustmentPrediction = async () => {
    try {
      setIsLoading(true);
      
      // Fetch initial data in parallel
      const [totalBlocks, contractData] = await Promise.all([
        fetchLatestBlockHeight(),
        fetchContractData()
      ]);
      
      const { fctMintedSoFar, currentMintRate } = contractData;

      // Calculate period info
      const currentPeriod = Math.floor(totalBlocks / 10000) + 1;
      const periodStartBlock = (currentPeriod - 1) * 10000;
      const periodEndBlock = periodStartBlock + 9999;
      const blocksElapsedInPeriod = totalBlocks - periodStartBlock + 1;
      const percentComplete = (blocksElapsedInPeriod / 10000) * 100;
      const blocksRemaining = 10000 - blocksElapsedInPeriod;

      // Create array of block numbers to fetch
      const blockNumbers = [];
      const step = 1000;
      for (let block = periodStartBlock; block <= totalBlocks - (totalBlocks % step); block += step) {
        blockNumbers.push(block);
      }

      // Fetch all historical data points in parallel
      const historyPoints = await Promise.all(
        blockNumbers.map(async (block) => {
          const issuance = await fetchHistoricalData(block);
          if (issuance !== null) {
            return {
              block,
              issuance,
              timestamp: Date.now() - ((totalBlocks - block) * 12 * 1000)
            };
          }
          return null;
        })
      );

      // Add the current block data
      const currentPoint = {
        block: totalBlocks,
        issuance: fctMintedSoFar,
        timestamp: Date.now()
      };

      // Filter out nulls and add current point
      setIssuanceHistory([...historyPoints.filter(point => point !== null), currentPoint]);

      const halvingPeriod = Math.floor(totalBlocks / BLOCKS_PER_HALVING);
      const targetFCT = calculateTargetFCT(totalBlocks);
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

      // Simplified output format
      const output = {
        currentMintRate,
        forecastedMintRate,
        changePercent: changeInMintRatePercent,
        progress: percentComplete,
        targetCompletion: (forecastedIssuance / 400000) * 100,
        blocksRemaining,
        fctMintedSoFar,
        forecastedIssuance
      };

      setForecastResults(output);
    } catch (error) {
      console.error('Error in calculateAdjustmentPrediction:', error);
      setForecastResults(null);
    } finally {
      setIsLoading(false);
    }
  };

  const renderGraph = () => {
    if (!issuanceHistory.length) return null;

    const height = 100;
    const width = 300;
    const padding = 20;
    const maxY = 600000;
    const targetY = 400000;
    
    // Calculate period blocks
    const periodStartBlock = Math.floor(issuanceHistory[0].block / 10000) * 10000;
    const periodEndBlock = periodStartBlock + 9999;
    const currentBlock = issuanceHistory[issuanceHistory.length - 1].block;
    const currentX = padding + ((currentBlock - periodStartBlock) / 10000) * (width - 2 * padding);
    
    const targetLineY = height - padding - ((targetY / maxY) * (height - 2 * padding));
    
    return (
      <div style={{ 
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
        <div style={{ fontSize: '12px', color: '#666' }}>Issuance Graph</div>
        <svg width={width} height={height + 15} style={{ background: '#f5f5f5', borderRadius: '4px' }}>
          {/* Target line */}
          <line
            x1={padding}
            y1={targetLineY}
            x2={width - padding}
            y2={targetLineY}
            stroke="#16a34a"
            strokeWidth="1"
            strokeDasharray="4"
          />
          
          {/* Y-axis labels */}
          <text x={2} y={padding} fontSize="10" fill="#666">600k</text>
          <text x={2} y={targetLineY + 3} fontSize="10" fill="#16a34a">400k</text>
          <text x={2} y={height - padding + 10} fontSize="10" fill="#666">0</text>

          {/* X-axis labels */}
          <text 
            x={padding} 
            y={height + 12} 
            fontSize="10" 
            fill="#666" 
            textAnchor="middle"
          >
            {periodStartBlock.toLocaleString()}
          </text>
          <text 
            x={currentX} 
            y={height + 12} 
            fontSize="10" 
            fill="#3F19D9" 
            textAnchor="middle"
          >
            {currentBlock.toLocaleString()}
          </text>
          <text 
            x={width - padding} 
            y={height + 12} 
            fontSize="10" 
            fill="#666" 
            textAnchor="middle"
          >
            {periodEndBlock.toLocaleString()}
          </text>

          {/* Current block vertical line */}
          <line
            x1={currentX}
            y1={padding}
            x2={currentX}
            y2={height - padding}
            stroke="#3F19D9"
            strokeWidth="1"
            strokeDasharray="2"
          />

          {/* Issuance line */}
          {issuanceHistory.map((point, i, arr) => {
            if (i === 0) return null;
            const prev = arr[i - 1];
            
            const x1 = padding + ((prev.block - periodStartBlock) / 10000) * (width - 2 * padding);
            const x2 = padding + ((point.block - periodStartBlock) / 10000) * (width - 2 * padding);
            const y1 = height - padding - ((prev.issuance / maxY) * (height - 2 * padding));
            const y2 = height - padding - ((point.issuance / maxY) * (height - 2 * padding));

            return (
              <line
                key={point.block}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#3F19D9"
                strokeWidth="2"
              />
            );
          })}
        </svg>
      </div>
    );
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
      </h1>
      {isLoading && <button onClick={calculateAdjustmentPrediction} disabled={isLoading}>
        {isLoading ? 'Loading...' : 'Refresh Forecast'}
      </button>}
      
      <style>
        {`
          .stats-grid {
            display: grid;
            grid-template-columns: minmax(auto, max-content);
            justify-content: start;
            gap: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            max-width: calc(100% - 40px);  /* Account for margins */
          }

          .stat-unit {
            display: flex;
            flex-direction: column;
            gap: 4px;
            background: #f5f5f5;
            padding: 15px;
            border-radius: 8px;
            width: 100%;
            min-width: 0;  /* Allow content to shrink */
            overflow: hidden;  /* Prevent overflow */
          }

          .value {
            font-size: 20px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        `}
      </style>

      {forecastResults && (
        <div className="stats-grid">
          <div className="stat-unit">
            <div style={{ fontSize: '12px', color: '#666' }}>Current Period</div>
            <div style={{ fontSize: '20px', fontWeight: '600' }}>
              {(() => {
                const secondsLeft = forecastResults.blocksRemaining * 12;
                const days = Math.floor(secondsLeft / (24 * 60 * 60));
                const hours = Math.floor((secondsLeft % (24 * 60 * 60)) / (60 * 60));
                return `${days}d ${hours}h remaining`;
              })()}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {forecastResults.progress.toFixed(0)}% complete
            </div>
          </div>

          <div className="stat-unit">
            <div style={{ fontSize: '12px', color: '#666' }}>Current Rate</div>
            <div style={{ fontSize: '20px', fontWeight: '600' }}>
              {forecastResults.currentMintRate.toLocaleString()}
              <span style={{ fontSize: '14px', color: '#666', marginLeft: '4px' }}>gwei</span>
            </div>
          </div>

          <div className="stat-unit">
            <div style={{ fontSize: '12px', color: '#666' }}>FCT Mined</div>
            <div style={{ fontSize: '20px', fontWeight: '600' }}>
              {forecastResults.fctMintedSoFar.toLocaleString()}
              <span style={{ fontSize: '14px', color: '#666', marginLeft: '4px' }}>FCT</span>
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {Math.round((forecastResults.fctMintedSoFar / 400000) * 100)}% of target
            </div>
          </div>

          <div className="stat-unit">
            <div style={{ fontSize: '12px', color: '#666' }}>Forecasted FCT Mined</div>
            <div style={{ fontSize: '20px', fontWeight: '600' }}>
              {forecastResults.forecastedIssuance.toLocaleString()}
              <span style={{ fontSize: '14px', color: '#666', marginLeft: '4px' }}>FCT</span>
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {forecastResults.targetCompletion.toFixed(0)}% of target
            </div>
          </div>

          <div className="stat-unit">
            <div style={{ fontSize: '12px', color: '#666' }}>Next Rate</div>
            <div style={{ fontSize: '20px', fontWeight: '600' }}>
              {forecastResults.forecastedMintRate.toLocaleString()}
              <span style={{ fontSize: '14px', color: '#666', marginLeft: '4px' }}>gwei</span>
            </div>
            <div style={{ 
              fontSize: '12px', 
              color: forecastResults.changePercent > 0 ? '#16a34a' : '#dc2626'
            }}>
              {forecastResults.changePercent > 0 ? '↑' : '↓'} {Math.abs(forecastResults.changePercent).toFixed(1)}% change
            </div>
          </div>

          <div className="stat-unit">
            {renderGraph()}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;