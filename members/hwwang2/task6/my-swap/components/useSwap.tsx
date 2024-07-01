// import { ethers, Contract } from 'ethers';
import { ethers, Contract} from 'ethersv5'
// import { useAccount, useContract, useProvider, useSigner } from 'wagmi';
import { useSendTransaction, useReadContracts, useWriteContract, useAccount, useChainId } from 'wagmi';
import { Token } from '@uniswap/sdk-core';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import ISwapRouterArtifact from '@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json';
import IUniswapV3FactoryArtifact from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json';
import QuoterV2 from '@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json'
import { erc20Abi, Address } from 'viem';
import { formatUnits, parseUnits } from 'viem'
import { Percent, CurrencyAmount, TradeType } from '@uniswap/sdk-core'
import { computePoolAddress,FeeAmount,POOL_INIT_CODE_HASH } from '@uniswap/v3-sdk';
// 这里引入alphaRouter后，有一个官方已知的bug，还没有修，：https://github.com/Uniswap/smart-order-router/issues/518#issuecomment-2034291988
import { AlphaRouter, SwapOptionsSwapRouter02, SwapType } from '@uniswap/smart-order-router'


import useFromToken from './useFromToken';
import { SEPOLIA_ALCHMY_KEY,UNI_FACTORY_ADDRESS,QUOTER_CONTRACT_ADDRESS,ROUTER_ADDRESS,SELECT_ALCHEMY_NETWORK } from './config';
import { message } from 'antd';

interface Immutables {
  token0: string;
  token1: string;
  fee: number;
}

interface State {
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
}


const provider = new ethers.providers.AlchemyProvider(SELECT_ALCHEMY_NETWORK,SEPOLIA_ALCHMY_KEY);
// const provider = ethers.getDefaultProvider();


const useSwap = (fromTokenAddress: string, toTokenAddress: string,fromTokenDecimal: number, toTokenDecimal: number) => {
  // const provider = useProvider();
  const chainId = useChainId();
  const { sendTransaction } = useSendTransaction()
  const { address } = useAccount();
  const baseContract = new Contract(UNI_FACTORY_ADDRESS, IUniswapV3FactoryArtifact.abi, provider)
  
  const tokenA = new Token(chainId, fromTokenAddress, fromTokenDecimal);
  const tokenB = new Token(chainId, toTokenAddress, toTokenDecimal);
  const poolAddress = computePoolAddress({
    factoryAddress: UNI_FACTORY_ADDRESS,
    tokenA, 
    tokenB,
    fee: FeeAmount.MEDIUM,
    chainId,
    initCodeHashManualOverride:POOL_INIT_CODE_HASH
  });
  
  const { approve } = useFromToken(fromTokenAddress);
  const {writeContractAsync} = useWriteContract()

  const swap = async (amount: number|string, sliper: number) => {
    const immutables = await getPoolImmutables();
    const parsedAmount = parseUnits(amount.toString(), fromTokenDecimal);
    await approve(ROUTER_ADDRESS, amount, fromTokenDecimal);

    const router = new AlphaRouter({
      chainId,
      provider:provider,
    });
    const options: SwapOptionsSwapRouter02 = {
      recipient: address as Address,
      slippageTolerance: new Percent(50, 10_000),
      deadline: Math.floor(Date.now() / 1000 + 1800),
      type: SwapType.SWAP_ROUTER_02,
    };
    const route = await router.route(
      CurrencyAmount.fromRawAmount(
        tokenA,
        parsedAmount.toString()
      ),
      tokenB,
      TradeType.EXACT_INPUT,
      options
    );

    if (!route || !route.methodParameters) {
      message.warning("未找到swap 路由");
      return "";
    }

    const txRes = sendTransaction({
      data: route.methodParameters.calldata as `0x${string}`,
      to: ROUTER_ADDRESS,
      value: BigInt(route.methodParameters.value),
      // maxFeePerGas: MAX_FEE_PER_GAS,
      // maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
    })
    return txRes;
  };

  const getQuote = async (amount: number) => {
    if(amount<=0){
      return "0";
    }
    // const address2 = await baseContract.getPool(fromTokenAddress, toTokenAddress, 3000);
    // console.log(address2);
    console.log(poolAddress);
    // const [immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()]);
    const poolContract = new Contract(poolAddress, IUniswapV3PoolABI.abi, provider);
    const [token0, token1, fee, liquidity, slot0] = await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee(),
      poolContract.liquidity(),
      poolContract.slot0(),
    ])
    // const pool = new Pool(
    //   token0,
    //   token1,
    //   fee,
    //   slot0[0].toString(),
    //   liquidity.toString(),
    //   slot0[1]
    // );

    // const outputAmount = amount * parseFloat(pool.token1Price.toFixed(2));
    // return outputAmount;
    const quoterContract = new ethers.Contract(
      QUOTER_CONTRACT_ADDRESS,
      QuoterV2.abi,
      provider
    );
    const input = parseUnits(
      amount.toString(),
      fromTokenDecimal
    ).toString();
    const quotedAmountOut = await quoterContract.quoteExactInputSingle.staticCall(
      {
        tokenIn:fromTokenAddress,
        tokenOut:toTokenAddress,
        fee,
        amountIn:input,
        sqrtPriceLimitX96:0
      }
    )
    return formatUnits(quotedAmountOut[0], toTokenDecimal);
  };

  const getPoolImmutables = async () => {
    // const address = await baseContract.getPool(fromTokenAddress, toTokenAddress, 3000);
    const poolContract = new Contract(poolAddress, IUniswapV3PoolABI.abi,provider);
    const [token0, token1, fee] = await Promise.all([poolContract.token0(), poolContract.token1(), poolContract.fee()]);
    const immutables: Immutables = {
      token0,
      token1,
      fee
    };
    return immutables;
  };

  const getPoolState = async () => {
    // const address = await baseContract.getPool(fromTokenAddress, toTokenAddress, 3000);
    const poolContract = new Contract(poolAddress, IUniswapV3PoolABI.abi,provider);
    const [liquidity, slot] = await Promise.all([poolContract.liquidity(), poolContract.slot0()]);
    const PoolState: State = {
      liquidity,
      sqrtPriceX96: BigInt(slot[0]),
      tick: slot[1]
    };

    return PoolState;
  };

  return { swap, getQuote };
};

export default useSwap;
