import { ethers, upgrades, waffle } from "hardhat";
import { Signer, BigNumberish, utils, Wallet, BigNumber, constants } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import "@openzeppelin/test-helpers";
import {
  MockERC20,
  MockERC20__factory,
  PancakeFactory,
  PancakeFactory__factory,
  PancakeRouterV2__factory,
  PancakeMasterChef,
  PancakeMasterChef__factory,
  PancakePair,
  PancakePair__factory,
  PancakeRouterV2,
  PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading,
  PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading__factory,
  PancakeswapV2RestrictedSingleAssetStrategyAddBaseTokenOnly,
  PancakeswapV2RestrictedSingleAssetStrategyAddBaseTokenOnly__factory,
  PancakeswapV2RestrictedSingleAssetStrategyAddBaseWithFarm,
  PancakeswapV2RestrictedSingleAssetStrategyAddBaseWithFarm__factory,
  PancakeswapV2RestrictedSingleAssetStrategyLiquidate,
  PancakeswapV2RestrictedSingleAssetStrategyLiquidate__factory,
  MockVaultForRestrictedCakeMaxiAddBaseWithFarm,
  MockVaultForRestrictedCakeMaxiAddBaseWithFarm__factory,
  WETH,
  WETH__factory,
  WNativeRelayer__factory,
  WNativeRelayer,
  CakeMaxiWorker__factory,
  CakeMaxiWorker,
  CakeToken,
  SyrupBar,
  CakeToken__factory,
  SyrupBar__factory,
  MockBeneficialVault,
  MockBeneficialVault__factory,
  Vault,
  Vault__factory,
  SimpleVaultConfig,
  SimpleVaultConfig__factory,
  DebtToken__factory,
  DebtToken,
  FairLaunch,
  FairLaunch__factory,
  AlpacaToken__factory,
  AlpacaToken
} from "../typechain";
import * as TimeHelpers from "./helpers/time"
import * as Assert from "./helpers/assert"
import { MAX_INTEGER } from "ethereumjs-util";

chai.use(solidity);
const { expect } = chai;

describe('CakeMaxiWorker', () => {
  const FOREVER = '2000000000';
  const CAKE_REWARD_PER_BLOCK = ethers.utils.parseEther('0.1');
  const ALPACA_BONUS_LOCK_UP_BPS = 7000;
  const ALPACA_REWARD_PER_BLOCK = ethers.utils.parseEther('5000');
  const REINVEST_BOUNTY_BPS = '100'; // 1% reinvest bounty
  const RESERVE_POOL_BPS = '0'; // 0% reserve pool
  const KILL_PRIZE_BPS = '1000'; // 10% Kill prize
  const INTEREST_RATE = '3472222222222'; // 30% per year
  const MIN_DEBT_SIZE = ethers.utils.parseEther('0.05'); // 1 BTOKEN min debt size
  const ZERO_BENEFICIALVAULT_BOUNTY_BPS = '0'
  const BENEFICIALVAULT_BOUNTY_BPS = '1000'
  const poolId = 0
  const WORK_FACTOR = '7000';
  const KILL_FACTOR = '8000';

  /// PancakeswapV2-related instance(s)
  let factoryV2: PancakeFactory;
  let routerV2: PancakeRouterV2;
  let masterChef: PancakeMasterChef;

  /// cake maxi worker instance(s)
  let cakeMaxiWorkerNative: CakeMaxiWorker;
  let cakeMaxiWorkerNonNative: CakeMaxiWorker;
  let integratedCakeMaxiWorker: CakeMaxiWorker;

  /// Token-related instance(s)
  let wbnb: WETH
  let baseToken: MockERC20;
  let alpaca: AlpacaToken;
  let cake: CakeToken;
  let syrup: SyrupBar;

  /// Strategy instance(s)
  let stratAdd: PancakeswapV2RestrictedSingleAssetStrategyAddBaseTokenOnly
  let stratLiq: PancakeswapV2RestrictedSingleAssetStrategyLiquidate
  let stratAddWithFarm: PancakeswapV2RestrictedSingleAssetStrategyAddBaseWithFarm
  let stratMinimize: PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading;
  let stratEvil: PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading

  // Accounts
  let deployer: Signer;
  let alice: Signer;
  let bob: Signer;
  let eve: Signer;

  // Vault
  let mockedVault: MockVaultForRestrictedCakeMaxiAddBaseWithFarm
  let mockedBeneficialVault: MockBeneficialVault
  let integratedVault: Vault
  let simpleVaultConfig: SimpleVaultConfig
  let debtToken: DebtToken
  let fairLaunch: FairLaunch

  // Contract Signer
  let baseTokenAsAlice: MockERC20;
  let baseTokenAsBob: MockERC20;

  let cakeAsAlice: MockERC20;

  let wbnbTokenAsAlice: WETH;
  let wbnbTokenAsBob: WETH;

  let routerV2AsAlice: PancakeRouterV2;

  let cakeMaxiWorkerNativeAsAlice: CakeMaxiWorker
  let cakeMaxiWorkerNonNativeAsAlice: CakeMaxiWorker
  let cakeMaxiWorkerNativeAsEve: CakeMaxiWorker
  let cakeMaxiWorkerNonNativeAsEve: CakeMaxiWorker
  let notOperatorCakeMaxiWorker: CakeMaxiWorker
  let integratedVaultAsAlice: Vault
  let integratedVaultAsBob: Vault
  let integratedCakeMaxiWorkerAsEve: CakeMaxiWorker

  let wNativeRelayer: WNativeRelayer;

  beforeEach(async () => {
    [deployer, alice, bob, eve] = await ethers.getSigners();

    // Setup Mocked Vault (for unit testing purposed)
    const MockVault =  (await ethers.getContractFactory(
      "MockVaultForRestrictedCakeMaxiAddBaseWithFarm",
      deployer
      )) as MockVaultForRestrictedCakeMaxiAddBaseWithFarm__factory;
    mockedVault = await upgrades.deployProxy(MockVault) as MockVaultForRestrictedCakeMaxiAddBaseWithFarm;
    await mockedVault.deployed();
    await mockedVault.setMockOwner(await alice.getAddress())

    // Setup Pancakeswap
    const PancakeFactory = (await ethers.getContractFactory(
      "PancakeFactory",
      deployer
    )) as PancakeFactory__factory;
    factoryV2 = await PancakeFactory.deploy((await deployer.getAddress()));
    await factoryV2.deployed();

    const WBNB = (await ethers.getContractFactory(
      "WETH",
      deployer
    )) as WETH__factory;
    wbnb = await WBNB.deploy();
    await wbnb.deployed()

    // Setup WNativeRelayer
    const WNativeRelayer = (await ethers.getContractFactory(
      'WNativeRelayer',
      deployer
    )) as WNativeRelayer__factory;
    wNativeRelayer = await WNativeRelayer.deploy(wbnb.address);
    await wNativeRelayer.deployed();

    const PancakeRouterV2 = (await ethers.getContractFactory(
      "PancakeRouterV2",
      deployer
    )) as PancakeRouterV2__factory;
    routerV2 = await PancakeRouterV2.deploy(factoryV2.address, wbnb.address);
    await routerV2.deployed();

    // Setup token stuffs
    const MockERC20 = (await ethers.getContractFactory(
      "MockERC20",
      deployer
    )) as MockERC20__factory
    baseToken = await upgrades.deployProxy(MockERC20, ['BTOKEN', 'BTOKEN']) as MockERC20;
    await baseToken.deployed();
    await baseToken.mint(await alice.getAddress(), ethers.utils.parseEther('100'));
    await baseToken.mint(await bob.getAddress(), ethers.utils.parseEther('100'));
    const AlpacaToken = (await ethers.getContractFactory(
      "AlpacaToken",
      deployer
    )) as AlpacaToken__factory;
    alpaca = await AlpacaToken.deploy(132, 137);
    await alpaca.deployed();
    await alpaca.mint(await deployer.getAddress(), ethers.utils.parseEther('1000'));
    const CakeToken = (await ethers.getContractFactory(
      "CakeToken",
      deployer
    )) as CakeToken__factory;
    cake = await CakeToken.deploy();
    await cake.deployed()
    await cake["mint(address,uint256)"](await deployer.getAddress(), ethers.utils.parseEther('100'));
    await cake["mint(address,uint256)"](await alice.getAddress(), ethers.utils.parseEther('10'));
    await cake["mint(address,uint256)"](await bob.getAddress(), ethers.utils.parseEther('10'));
    await factoryV2.createPair(baseToken.address, wbnb.address);
    await factoryV2.createPair(cake.address, wbnb.address);
    await factoryV2.createPair(alpaca.address, wbnb.address);
    const SyrupBar = (await ethers.getContractFactory(
      "SyrupBar",
      deployer
    )) as SyrupBar__factory;
    syrup = await SyrupBar.deploy(cake.address);
    await syrup.deployed();

    // add beneficial vault with alpaca as an underlying token, thus beneficialVault reward is ALPACA
    const MockBeneficialVault =  (await ethers.getContractFactory(
      "MockBeneficialVault",
      deployer
      )) as MockBeneficialVault__factory;
    mockedBeneficialVault = await upgrades.deployProxy(MockBeneficialVault, [alpaca.address]) as MockBeneficialVault;
    await mockedBeneficialVault.deployed();
    await mockedBeneficialVault.setMockOwner(await alice.getAddress())

    // Setup Strategies
    const PancakeswapV2RestrictedSingleAssetStrategyAddBaseTokenOnly = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedSingleAssetStrategyAddBaseTokenOnly",
      deployer
    )) as PancakeswapV2RestrictedSingleAssetStrategyAddBaseTokenOnly__factory;
    stratAdd = await upgrades.deployProxy(PancakeswapV2RestrictedSingleAssetStrategyAddBaseTokenOnly, [routerV2.address]) as PancakeswapV2RestrictedSingleAssetStrategyAddBaseTokenOnly;
    await stratAdd.deployed();
    const PancakeswapV2RestrictedSingleAssetStrategyAddBaseWithFarm = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedSingleAssetStrategyAddBaseWithFarm",
      deployer
    )) as PancakeswapV2RestrictedSingleAssetStrategyAddBaseWithFarm__factory;
    stratAddWithFarm = await upgrades.deployProxy(PancakeswapV2RestrictedSingleAssetStrategyAddBaseWithFarm, [routerV2.address, mockedVault.address]) as PancakeswapV2RestrictedSingleAssetStrategyAddBaseWithFarm;
    await stratAddWithFarm.deployed();
    const PancakeswapV2RestrictedSingleAssetStrategyLiquidate = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedSingleAssetStrategyLiquidate",
      deployer
    )) as PancakeswapV2RestrictedSingleAssetStrategyLiquidate__factory;
    stratLiq = await upgrades.deployProxy(PancakeswapV2RestrictedSingleAssetStrategyLiquidate, [routerV2.address]) as PancakeswapV2RestrictedSingleAssetStrategyLiquidate;
    await stratLiq.deployed();
    const PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading",
      deployer
    )) as PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading__factory;
    stratMinimize = await upgrades.deployProxy(PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading, [routerV2.address, wNativeRelayer.address]) as PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading;
    await stratMinimize.deployed();
    const EvilStrat = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading",
      deployer
    )) as PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading__factory;
    stratEvil = await upgrades.deployProxy(EvilStrat, [routerV2.address, wNativeRelayer.address]) as PancakeswapV2RestrictedSingleAssetStrategyWithdrawMinimizeTrading;
    await stratEvil.deployed()

    /// Setup MasterChef
    const PancakeMasterChef = (await ethers.getContractFactory(
    "PancakeMasterChef",
    deployer
    )) as PancakeMasterChef__factory;
    masterChef = await PancakeMasterChef.deploy(
      cake.address, syrup.address, await deployer.getAddress(), CAKE_REWARD_PER_BLOCK, 0);
    await masterChef.deployed();
    // Transfer ownership so masterChef can mint CAKE
    await cake.transferOwnership(masterChef.address);
    await syrup.transferOwnership(masterChef.address);

    // Setup Cake Maxi Worker
    const CakeMaxiWorker = (await ethers.getContractFactory(
      "CakeMaxiWorker",
      deployer,
    )) as CakeMaxiWorker__factory;
    cakeMaxiWorkerNative = await upgrades.deployProxy(CakeMaxiWorker,
      [
        await alice.getAddress(),
        wbnb.address,
        masterChef.address,
        routerV2.address,
        mockedBeneficialVault.address,
        poolId,
        stratAdd.address,
        stratLiq.address,
        REINVEST_BOUNTY_BPS,
        ZERO_BENEFICIALVAULT_BOUNTY_BPS,
        [wbnb.address, cake.address],
        [cake.address, wbnb.address, alpaca.address]
      ]
    ) as CakeMaxiWorker
    await cakeMaxiWorkerNative.deployed();

    cakeMaxiWorkerNonNative = await upgrades.deployProxy(CakeMaxiWorker,
      [
        await alice.getAddress(),
        baseToken.address,
        masterChef.address,
        routerV2.address, 
        mockedBeneficialVault.address,
        poolId,
        stratAdd.address,
        stratLiq.address,
        REINVEST_BOUNTY_BPS,
        ZERO_BENEFICIALVAULT_BOUNTY_BPS,
        [baseToken.address, wbnb.address, cake.address],
        [cake.address, wbnb.address, alpaca.address]
      ]
    ) as CakeMaxiWorker
    await cakeMaxiWorkerNonNative.deployed();

    // Set Up integrated Vault (for integration test purposed)
    const FairLaunch = (await ethers.getContractFactory(
      "FairLaunch",
      deployer
    )) as FairLaunch__factory;
    fairLaunch = await FairLaunch.deploy(
      alpaca.address, (await deployer.getAddress()), ALPACA_REWARD_PER_BLOCK, 0, ALPACA_BONUS_LOCK_UP_BPS, 0
    );
    await fairLaunch.deployed();

    await alpaca.transferOwnership(fairLaunch.address);

    const SimpleVaultConfig = (await ethers.getContractFactory(
      "SimpleVaultConfig",
      deployer
    )) as SimpleVaultConfig__factory;
    simpleVaultConfig = await upgrades.deployProxy(SimpleVaultConfig, [
      MIN_DEBT_SIZE, INTEREST_RATE, RESERVE_POOL_BPS, KILL_PRIZE_BPS,
      wbnb.address, wNativeRelayer.address, fairLaunch.address
    ]) as SimpleVaultConfig;
    await simpleVaultConfig.deployed();

    const DebtToken = (await ethers.getContractFactory(
      "DebtToken",
      deployer
    )) as DebtToken__factory;
    debtToken = await upgrades.deployProxy(DebtToken, [
      'debtibBTOKEN_V2', 'debtibBTOKEN_V2', (await deployer.getAddress())]) as DebtToken;
    await debtToken.deployed();

    const Vault = (await ethers.getContractFactory(
      "Vault",
      deployer
    )) as Vault__factory;
    integratedVault = await upgrades.deployProxy(Vault, [
      simpleVaultConfig.address, wbnb.address, 'Interest Bearing BNB', 'ibBNB', 18, debtToken.address
    ]) as Vault;
    await integratedVault.deployed();
    await debtToken.transferOwnership(integratedVault.address);
    // Update DebtToken
    await integratedVault.updateDebtToken(debtToken.address, 0);

    // Add FairLaunch pool and set fairLaunchPoolId for Vault
    await fairLaunch.addPool(1, (await integratedVault.debtToken()), false);
    await integratedVault.setFairLaunchPoolId(0);

    // Setup integrated CakeMaxiWorker for integration test
    integratedCakeMaxiWorker = await upgrades.deployProxy(CakeMaxiWorker, [
      integratedVault.address,
      wbnb.address,
      masterChef.address,
      routerV2.address,
      integratedVault.address,
      poolId,
      stratAdd.address,
      stratLiq.address,
      REINVEST_BOUNTY_BPS,
      ZERO_BENEFICIALVAULT_BOUNTY_BPS,
      [wbnb.address, cake.address],
      [cake.address, wbnb.address]
    ]) as CakeMaxiWorker
    await cakeMaxiWorkerNonNative.deployed();

    // Setting up dependencies for workers & strategies
    await simpleVaultConfig.setWorker(integratedCakeMaxiWorker.address, true, true, WORK_FACTOR, KILL_FACTOR);
    await wNativeRelayer.setCallerOk([stratMinimize.address, stratLiq.address, stratAddWithFarm.address, stratAdd.address, integratedVault.address], true)
    await cakeMaxiWorkerNative.setStrategyOk([stratAdd.address, stratAddWithFarm.address, stratLiq.address, stratMinimize.address], true);
    await cakeMaxiWorkerNative.setReinvestorOk([await eve.getAddress()], true);
    await cakeMaxiWorkerNonNative.setStrategyOk([stratAdd.address, stratAddWithFarm.address, stratLiq.address, stratMinimize.address], true);
    await cakeMaxiWorkerNonNative.setReinvestorOk([await eve.getAddress()], true);
    await integratedCakeMaxiWorker.setStrategyOk([stratAdd.address, stratAddWithFarm.address, stratLiq.address, stratMinimize.address], true)
    await integratedCakeMaxiWorker.setReinvestorOk([await eve.getAddress()], true)
    await stratAdd.setWorkersOk([cakeMaxiWorkerNative.address, cakeMaxiWorkerNonNative.address, integratedCakeMaxiWorker.address], true)
    await stratAddWithFarm.setWorkersOk([cakeMaxiWorkerNative.address, cakeMaxiWorkerNonNative.address, integratedCakeMaxiWorker.address], true)   
    await stratLiq.setWorkersOk([cakeMaxiWorkerNative.address, cakeMaxiWorkerNonNative.address, integratedCakeMaxiWorker.address], true)
    await stratMinimize.setWorkersOk([cakeMaxiWorkerNative.address, cakeMaxiWorkerNonNative.address, integratedCakeMaxiWorker.address], true)
    await stratEvil.setWorkersOk([cakeMaxiWorkerNative.address, cakeMaxiWorkerNonNative.address, integratedCakeMaxiWorker.address], true)
    
    // Assign contract signer
    baseTokenAsAlice = MockERC20__factory.connect(baseToken.address, alice);
    baseTokenAsBob = MockERC20__factory.connect(baseToken.address, bob);
    cakeAsAlice = MockERC20__factory.connect(cake.address, alice);
    wbnbTokenAsAlice = WETH__factory.connect(wbnb.address, alice)
    wbnbTokenAsBob = WETH__factory.connect(wbnb.address, bob)
    routerV2AsAlice = PancakeRouterV2__factory.connect(routerV2.address, alice);
    cakeMaxiWorkerNativeAsAlice = CakeMaxiWorker__factory.connect(cakeMaxiWorkerNative.address, alice);
    cakeMaxiWorkerNonNativeAsAlice = CakeMaxiWorker__factory.connect(cakeMaxiWorkerNonNative.address, alice);
    cakeMaxiWorkerNativeAsEve = CakeMaxiWorker__factory.connect(cakeMaxiWorkerNative.address, eve);
    cakeMaxiWorkerNonNativeAsEve = CakeMaxiWorker__factory.connect(cakeMaxiWorkerNonNative.address, eve);
    notOperatorCakeMaxiWorker = CakeMaxiWorker__factory.connect(cakeMaxiWorkerNative.address, bob);
    integratedVaultAsAlice = Vault__factory.connect(integratedVault.address, alice)
    integratedVaultAsBob = Vault__factory.connect(integratedVault.address, bob)
    integratedCakeMaxiWorkerAsEve =  CakeMaxiWorker__factory.connect(integratedCakeMaxiWorker.address, eve);
    
    // Adding liquidity to the pool
    await wbnbTokenAsAlice.deposit({
      value: ethers.utils.parseEther('52')
    })
    await wbnbTokenAsBob.deposit({
      value: ethers.utils.parseEther('50')
    })
    await wbnb.deposit({
      value: ethers.utils.parseEther('50')
    })
    await cakeAsAlice.approve(routerV2.address, ethers.utils.parseEther('0.1'));
    await baseTokenAsAlice.approve(routerV2.address, ethers.utils.parseEther('1'));
    await wbnbTokenAsAlice.approve(routerV2.address, ethers.utils.parseEther('2'))
    await alpaca.approve(routerV2.address, ethers.utils.parseEther('10'));
    await wbnb.approve(routerV2.address, ethers.utils.parseEther('10'));
    
    // Add liquidity to the BTOKEN-WBNB pool on Pancakeswap
    await routerV2AsAlice.addLiquidity(
      baseToken.address, wbnb.address,
      ethers.utils.parseEther('1'), ethers.utils.parseEther('1'), '0', '0', await alice.getAddress(), FOREVER);
    // Add liquidity to the CAKE-FTOKEN pool on Pancakeswap
    await routerV2AsAlice.addLiquidity(
      cake.address, wbnb.address,
      ethers.utils.parseEther('0.1'), 
      ethers.utils.parseEther('1'), 
      '0', 
      '0', 
      await alice.getAddress(), 
      FOREVER
    );
    // Add liquidity to the ALPACA-WBNB pool on Pancakeswap
    await routerV2.addLiquidity(
      wbnb.address, alpaca.address,
      ethers.utils.parseEther('10'), 
      ethers.utils.parseEther('10'), 
      '0', 
      '0', 
      await deployer.getAddress(), 
      FOREVER
    );
  });

  describe("#work()", async () => {
    context("When the caller is not an operator", async() => {
      it('should be reverted', async () => {
        await expect(notOperatorCakeMaxiWorker.work(
          0, await bob.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
              ['uint256'],
              [ethers.utils.parseEther('0.05')]
              )
            ],
          )
        )).to.revertedWith("CakeMaxiWorker::onlyOperator:: not operator")
      })
    })
    context("When the caller calling a non-whitelisted strategy", async() => {
      it('should be reverted', async () => {
        await expect(cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), ethers.utils.parseEther('0.1'),
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratEvil.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          )
        )).to.revertedWith("CakeMaxiWorker::work:: unapproved work strategy")
      })
    })
    context("When the operator calling a revoked strategy", async() => {
      it('should be reverted', async () => {
        await cakeMaxiWorkerNative.setStrategyOk([stratAdd.address], false)
        await expect(cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), ethers.utils.parseEther('0.1'),
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          )
        )).to.revertedWith("CakeMaxiWorker::work:: unapproved work strategy")
      })
    })
    context("When the user passes addBaseToken strategy", async() => {
      it('should convert an input base token to a farming token and stake to the masterchef', async () => {
        // sending 0.1 wbnb to the worker (let's pretend to be the value from the vault)
        // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB
        // amountOut of 0.1 will be
        // if 1WBNB = 0.1 FToken
        // 0.1WBNB will be (0.1*0.9975) * (0.1/(1+0.1*0.9975)) = 0.009070243237099340
        await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
        await cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), 0,
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          )
        )
        let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        // Alice uses AddBaseTokenOnly strategy to add another 0.1 WBNB
        // amountOut of 0.1 will be
        // if 1.1 WBNB = (0.1 - 0.00907024323709934) FToken
        // if 1.1 WBNB = 0.09092975676290066 FToken
        // 0.1 WBNB will be (0.1 * 0.9975 * 0.09092975676290066) /(1.1 + 0.1 * 0.9975)
        // = 0.0075601110540523785
        // thus, the current amount accumulated with the previous one will be 0.0075601110540523785 + 0.009070243237099340
        // = 0.01663035429115172
        await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
        await cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), 0,
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          )
        )
        // after all these steps above, alice will have a balance in total of 0.016630354291151718 
        userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.2').toString())
        // bob start opening his position using 0.1 wbnb
        // amountOut of 0.1 will be
        // if 1.2 WBNB = (0.1 - (0.00907024323709934 + 0.0075601110540523785)) FToken
        // if 1.2 WBNB = 0.08336964570884828 FToken
        // 0.1 WBNB will be (0.1 * 0.9975 * 0.08336964570884828) / (1.2+0.1*0.9975) = 0.006398247477943924
        // total farming token amount will be 0.016630354291151717 + 0.006398247477943924 = 0.23028601769095642
        await wbnbTokenAsBob.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
        await cakeMaxiWorkerNativeAsAlice.work(
          1, await bob.getAddress(), 0,
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          )
        )
        userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.023028601769095642'))
        expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        expect(await cakeMaxiWorkerNative.shares(1)).to.eq(ethers.utils.parseEther('0.006398247477943924'))
        expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(1))).to.eq(ethers.utils.parseEther('0.006398247477943924'))
        Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.4').toString())
      })
    })
    context("When the user passes addBaseWithFarm strategy", async() => {
      it('should convert an input as a base token with some farming token and stake to the masterchef', async () => {
        // Alice transfer 0.1 WBNB to StrategyAddBaseWithFarm first
        await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
        // Alice uses AddBaseWithFarm strategy to add 0.1 WBNB
        // amountOut of 0.1 will be
        // if 1WBNB = 0.1 FToken
        // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1 + 0.1 * 0.9975) = 0.00907024323709934
        await cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
          ['address', 'bytes'],
          [stratAddWithFarm.address, ethers.utils.defaultAbiCoder.encode(
            ['uint256', 'uint256'],
            ['0', '0']
          )],
          )
        );
      
        // after all these steps above, alice will have a balance in total of 0.00907024323709934
        let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        // Alice uses AddBaseWithFarm strategy to add another 0.1 WBNB
        // amountOut of 0.1 will be
        // if 1.1 WBNB = (0.1 - 0.00907024323709934) FToken
        // if 1.1 WBNB = 0.09092975676290066 FToken
        // 0.1 WBNB will be (0.1 * 0.9975 * 0.09092975676290066) / (1.1 + 0.1 * 0.9975) = 0.0075601110540523785
        // thus, the current amount accumulated with the previous one will be 0.0075601110540523785 + 0.00907024323709934 + 0.04 = 0.05663035429115172
        await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
        await cakeAsAlice.approve(mockedVault.address, ethers.utils.parseEther('0.04'));
        await cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
          ['address', 'bytes'],
          [stratAddWithFarm.address, ethers.utils.defaultAbiCoder.encode(
            ['uint256', 'uint256'],
            [ethers.utils.parseEther('0.04'), '0']
          )],
          )
        );
        // after all these steps above, alice will have a balance in total of 0.056630354291151718
        userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.056630354291151718'))
        expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.056630354291151718'))
        Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.3').toString())

        // Bob start opening his position using 0.1 wbnb
        // amountOut of 0.1 will be
        // if 1.2 WBNB = (0.1 - (0.0075601110540523785 + 0.00907024323709934)) FToken
        // if 1.2 WBNB = 0.08336964570884828 FToken
        // 0.1 WBNB will be (0.1 * 0.9975 * 0.08336964570884828) / (1.2 + 0.1 * 0.9975) = 0.006398247477943925
        // thus, total staked balance will be = 0.056630354291151718 + 0.006398247477943925 + 0.05 =  0.11302860176909564
        await wbnbTokenAsBob.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
        await cakeAsAlice.approve(mockedVault.address, ethers.utils.parseEther('0.05'));
        await cakeMaxiWorkerNativeAsAlice.work(
          1, await bob.getAddress(), 0,
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAddWithFarm.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'uint256'],
                [ethers.utils.parseEther('0.05'), '0']
              )
            ],
          )
        )
        userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.113028601769095642'))
        expect(await cakeMaxiWorkerNative.shares(1)).to.eq(ethers.utils.parseEther('0.056398247477943924'))
        expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(1))).to.eq(ethers.utils.parseEther('0.056398247477943924'))
        Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.6').toString())
      })
    })
    context("When the user passes liquidation strategy to close the position", async () => {
      context("When alice opened and closed her position", async() => {
        it('should liquidate a position based on the share of a user', async () => {
          // sending 0.1 wbnb to the worker (let's pretend to be the value from the vault)
          // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB
          // amountOut of 0.1 will be
          // if 1WBNB = 0.1 FToken
          // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1+ 0.1 * 0.9975) = 0.009070243237099340
          await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          const aliceBaseTokenBefore = await wbnb.balanceOf(await alice.getAddress())
          const aliceFarmingTokenBefore = await cake.balanceOf(await alice.getAddress())
          await cakeMaxiWorkerNativeAsAlice.work(
            0, await alice.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          // Alice call liquidate strategy to close her position
          await cakeMaxiWorkerNativeAsAlice.work(
            0, await alice.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratLiq.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          // alice will get a base token based on 0.00907024323709934 farming token (staked balance)
          // alice will get a base token based on 0.00907024323709934 farming token (staked balance)
          // if  0.1  - 0.00907024323709934 FTOKEN = 1.1 BNB
          // if 0.09092975676290066 FTOKEN = 1.1 BNB
          // 0.00907024323709934 FTOKEN = (0.00907024323709934 * 0.9975) * (1.1 / (0.09092975676290066 + 0.00907024323709934 * 0.9975)) = 0.0995458165383035 BNB
          // thus, alice should get a baseToken amount of 0.099545816538303460
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          const aliceBaseTokenAfter = await wbnb.balanceOf(await alice.getAddress())
          const aliceFarmingTokenAfter = await cake.balanceOf(await alice.getAddress())
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0'))
          expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0'))
          Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.1').toString())
          expect(aliceBaseTokenAfter.sub(aliceBaseTokenBefore)).to.eq(ethers.utils.parseEther('0.099545816538303460'))
          expect(aliceFarmingTokenAfter.sub(aliceFarmingTokenBefore)).to.eq(ethers.utils.parseEther('0'))
        })
      })
      context("When alice closed her position after bob did", async() => {
        it('should liquidate a position based on the share of a user', async () => {
          // sending 0.1 wbnb to the worker (let's pretend to be the value from the vault)
          // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB
          // amountOut of 0.1 will be
          // if 1WBNB = 0.1 FToken
          // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1+ 0.1 * 0.9975) = 0.009070243237099340
          await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          const aliceBaseTokenBefore = await wbnb.balanceOf(await alice.getAddress())
          const aliceFarmingTokenBefore = await cake.balanceOf(await alice.getAddress())
          await cakeMaxiWorkerNativeAsAlice.work(
            0, await alice.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          // if 1.1 WBNB = (0.1 - 0.00907024323709934) FToken
          // if 1.1 WBNB = 0.09092975676290066 FToken
          // 0.1 WBNB will be (0.1 * 0.9975 * 0.09092975676290066) / (1.1 + 0.1 * 0.9975) = 0.0075601110540523785
          // thus, bob will receive 0.0075601110540523785 FToken with the same share and worker's totalToken will be 0.0075601110540523785 + 0.00907024323709934
          // = 0.016630354291151718
          await wbnbTokenAsBob.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          await cakeMaxiWorkerNativeAsAlice.work(
            1, await bob.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.016630354291151718'))
          expect(await cakeMaxiWorkerNative.shares(1)).to.eq(ethers.utils.parseEther('0.007560111054052378'))
          // Alice call liquidate strategy to close her position
          await cakeMaxiWorkerNativeAsAlice.work(
            0, await alice.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratLiq.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          // alice will get a base token based on 0.00907024323709934 farming token (staked balance)
          // if  0.1  - 0.01663035429115172 FTOKEN = 1.2 BNB
          // if 0.08336964570884828 FTOKEN = 1.2 BNB
          // 0.00907024323709934 FTOKEN = (0.00907024323709934 * 0.9975 * 1.2) / (0.08336964570884828 + 0.00907024323709934 * 0.9975) = 0.117478992956832182 BNB
          // thus, alice should get a baseToken amount of 0.117478992956832182
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          const aliceBaseTokenAfter = await wbnb.balanceOf(await alice.getAddress())
          const aliceFarmingTokenAfter = await cake.balanceOf(await alice.getAddress())
          // only bobs' left
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.007560111054052378'))
          expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0'))
          // bob's position should remain the same
          expect(await cakeMaxiWorkerNative.shares(1)).to.eq(ethers.utils.parseEther('0.007560111054052378'))
          Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.3').toString())
          expect(aliceBaseTokenAfter.sub(aliceBaseTokenBefore)).to.eq(ethers.utils.parseEther('0.117478992956832182'))
          expect(aliceFarmingTokenAfter.sub(aliceFarmingTokenBefore)).to.eq(ethers.utils.parseEther('0'))
        })
      })
    })
    context("When the user passes close minimize trading strategy to close the position", async () => {
      it('should send a base token to be enough for repaying the debt, the rest will be sent as a farming token', async () => {
        // sending 0.1 wbnb to the worker (let's pretend to be the value from the vault)
        // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB
        // amountOut of 0.1 will be
        // if 1WBNB = 0.1 FToken
        // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / ( 1 + 0.1 * 0.9975) = 0.009070243237099340
        await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
        const aliceBaseTokenBefore = await wbnb.balanceOf(await alice.getAddress())
        const aliceFarmingTokenBefore = await cake.balanceOf(await alice.getAddress())
        await cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), 0,
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          )
        )
        let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        // Alice call minimize trading strategy to close her position
        await cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), ethers.utils.parseEther('0.05'),
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratMinimize.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          )
        )
        // 0.1 - 0.00907024323709934 FTOKEN = 1.1 WBNB
        // 0.09092975676290066 FTOKEN =  1.1 WBNB
        // x FTOKEN = (x * 0.9975 * 1.1) / (0.09092975676290066 + x * 0.9975) = 0.05 WBNB
        // x = 0.004340840518577427
        // thus, the remaining farming token will be 0.00907024323709934 - 0.004340840518577427 
        // = 0.004729402718521914
        userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        const aliceBaseTokenAfter = await wbnb.balanceOf(await alice.getAddress())
        const aliceFarmingTokenAfter = await cake.balanceOf(await alice.getAddress())
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0'))
        expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0'))
        Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.1').toString())
        expect(aliceBaseTokenAfter.sub(aliceBaseTokenBefore)).to.eq(ethers.utils.parseEther('0.05'))
        expect(aliceFarmingTokenAfter.sub(aliceFarmingTokenBefore)).to.eq(ethers.utils.parseEther('0.004729402718521912'))
      })
    })
  })

  describe("#reinvest()", async() => {
    context("When the caller is not a reinvestor", async () => {
      it('should be reverted', async () => {
        await expect(cakeMaxiWorkerNativeAsAlice.reinvest()).to.revertedWith('CakeMaxiWorker::onlyReinvestor:: not reinvestor')
      })
    })
    context("When the reinvestor reinvest in the middle of a transaction set", async () => {
      context('When beneficialVaultBounty takes 0% of reinvest bounty', async () => {
        it('should increase the size of total balance, bounty is sent to the reinvestor', async () => {
          // sending 0.1 wbnb to the worker (let's pretend to be the value from the vault)
          // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB
          // amountOut of 0.1 will be
          // if 1WBNB = 0.1 FToken
          // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1 + 0.1 * 0.9975) = 0.009070243237099340
          await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          await cakeMaxiWorkerNativeAsAlice.work(
            0, await alice.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(0))).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          // Alice uses AddBaseTokenOnly strategy to add another 0.1 WBNB
          // amountOut of 0.1 will be
          // if 1.1 WBNB = (0.1 - 0.00907024323709934) FToken
          // if 1.1 WBNB = 0.09092975676290066 FToken
          // 0.1 WBNB will be (0.1 * 0.9975 * 0.09092975676290066) / (1.1 + 0.1 * 0.9975) = 0.0075601110540523785
          // thus, the current amount accumulated with the previous one will be 0.0075601110540523785 + 0.009070243237099340
          // = 0.01663035429115172
          await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          await cakeMaxiWorkerNativeAsAlice.work(
            0, await alice.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          // after all these steps above, alice will have a balance in total of 0.016630354291151718 
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.016630354291151718'))
          expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.016630354291151718'))
          Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.2').toString())
          expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(0))).to.eq(ethers.utils.parseEther('0.016630354291151718'))
          // reinvest.. the size of the reward should be 3 (blocks) * 0.1 farming token (CAKE)
          await cakeMaxiWorkerNativeAsEve.reinvest()
          // eve, who is a reinvestor will get her bounty for 0.3 * 1% = 0.003
          Assert.assertAlmostEqual((await cake.balanceOf(await eve.getAddress())).toString(), ethers.utils.parseEther('0.003').toString())
          Assert.assertAlmostEqual((await alpaca.balanceOf(mockedBeneficialVault.address)).toString(), ethers.utils.parseEther('0').toString())
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          // Bob start opening his position using 0.1 wbnb
          // amountOut of 0.1 will be
          // if 1.2 WBNB = (0.1 - (0.00907024323709934 + 0.0075601110540523785)) FToken
          // if 1.2 WBNB = 0.08336964570884828 FToken
          // 0.1 WBNB will be (0.1 * 0.9975 * 0.08336964570884828) / (1.2 + 0.1 * 0.9975) = 0.006398247477943924
          // total farming token amount will be 0.016630354291151717 + 0.006398247477943924 + 0.1*3 from block reward - 0.1*3*0.01 deducted from bounty  = 0.320028601769079632
          const bobShare = ethers.utils.parseEther('0.006398247477943924').mul(await cakeMaxiWorkerNative.totalShare()).div(userInfo[0])
          const aliceShare = ethers.utils.parseEther('0.016630354291151718') // no need to readjust the LP balance since this happened before the reinvest
          await wbnbTokenAsBob.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          await cakeMaxiWorkerNativeAsAlice.work(
            1, await bob.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          const bobBalance = bobShare.mul(userInfo[0]).div(await cakeMaxiWorkerNative.totalShare())
          const aliceBalance = aliceShare.mul(userInfo[0]).div(await cakeMaxiWorkerNative.totalShare())
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.320028601769079632'))
          expect(await cakeMaxiWorkerNative.shares(1)).to.eq(bobShare)
          expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(1))).to.eq(bobBalance)
          expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(0))).to.eq(aliceBalance)
          // after reinvested, bob transfer and work once again, making the block advances by 2 this reward balance will be 0.1*2
          Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.2').toString())
        })
      })
      context('When beneficialVaultBounty takes 10% of reinvest bounty', async () => {
        it('should increase the size of total balance, bounty is sent to the reinvestor and beneficial vault based on a correct bps', async () => {
          await cakeMaxiWorkerNative.setBeneficialVaultBountyBps(BigNumber.from(BENEFICIALVAULT_BOUNTY_BPS))
          expect(await cakeMaxiWorkerNative.beneficialVaultBountyBps()).to.eq(BigNumber.from(BENEFICIALVAULT_BOUNTY_BPS))
          // sending 0.1 wbnb to the worker (let's pretend to be the value from the vault)
          // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB
          // amountOut of 0.1 will be
          // if 1WBNB = 0.1 FToken
          // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1 + 0.1 * 0.9975) = 0.009070243237099340
          await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          await cakeMaxiWorkerNativeAsAlice.work(
            0, await alice.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(0))).to.eq(ethers.utils.parseEther('0.00907024323709934'))
          // Alice uses AddBaseTokenOnly strategy to add another 0.1 WBNB
          // amountOut of 0.1 will be
          // if 1.1 WBNB = (0.1 - 0.00907024323709934) FToken
          // if 1.1 WBNB = 0.09092975676290066 FToken
          // 0.1 WBNB will be (0.1 * 0.9975 * 0.09092975676290066) / (1.1 + 0.1 * 0.9975) = 0.0075601110540523785
          // thus, the current amount accumulated with the previous one will be 0.0075601110540523785 + 0.009070243237099340
          // = 0.01663035429115172
          await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          await cakeMaxiWorkerNativeAsAlice.work(
            0, await alice.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          // after all these steps above, alice will have a balance in total of 0.016630354291151718 
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.016630354291151718'))
          expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.016630354291151718'))
          Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.2').toString())
          expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(0))).to.eq(ethers.utils.parseEther('0.016630354291151718'))
          // total bounty will be 0.3 * 1% = 0.003
          // 90% if reinvest bounty 0.003 * 90 / 100 = 0.0027
          // thus, alice we get a bounty of 0.0027
          // 10% of 0.003 (0.0003) will be distributed to the vault by swapping 0.003 of reward token into a beneficial vault token (this is scenario, it will be ALPACA)
          // if (0.1 - (0.00907024323709934 + 0.0075601110540523785)) FToken = 1.2 WBNB
          // 0.08336964570884828 FToken = 1.2 WBNB
          // 0.0003 will be (0.0003 * 0.9975 * 1.2) / (0.08336964570884828  + 0.0003 * 0.9975) = 0.004291917527507464 WBNB
          // if 10WBNB = 10ALPACA
          // 0.004291917527507464 WBNB =  (0.004291917527507464 * 0.9975 * 10) / (10  + 0.004291917527507464 * 0.9975) = 0.004279355661192217 ALPACA
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          await cakeMaxiWorkerNativeAsEve.reinvest()
          Assert.assertAlmostEqual((await cake.balanceOf(await eve.getAddress())).toString(), ethers.utils.parseEther('0.0027').toString())
          Assert.assertAlmostEqual((await alpaca.balanceOf(mockedBeneficialVault.address)).toString(), ethers.utils.parseEther('0.004279355661192217').toString())
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          // Bob start opening his position using 0.1 wbnb
          // amountOut of 0.1 will be
          // if (1.2 - 0.004291917527507464) WBNB = (0.1 - (0.00907024323709934 + 0.0075601110540523785) + 0.0003) FToken
          // if 1.1957080824724924 WBNB = 0.08366964570884827 FToken
          // 0.1 WBNB will be (0.1 * 0.9975 * 0.08366964570884827) / (1.1957080824724924 + 0.1 * 0.9975) = 0.006442545129309376
          // total farming token amount will be 0.016630354291151718 + 0.006442545129309376 + 0.1*3 from block reward - 0.1*3*0.01 deducted from bounty  = 0.32007289942046113
          const bobShare = ethers.utils.parseEther('0.006442545129309376').mul(await cakeMaxiWorkerNative.totalShare()).div(userInfo[0])
          const aliceShare = ethers.utils.parseEther('0.016630354291151718') // no need to readjust the LP balance since this happened before the reinvest
          await wbnbTokenAsBob.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
          await cakeMaxiWorkerNativeAsAlice.work(
            1, await bob.getAddress(), 0,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [stratAdd.address, 
                ethers.utils.defaultAbiCoder.encode(
                  ['uint256'],
                  [ethers.utils.parseEther('0')]
                )
              ],
            )
          )
          userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
          const bobBalance = bobShare.mul(userInfo[0]).div(await cakeMaxiWorkerNative.totalShare())
          const aliceBalance = aliceShare.mul(userInfo[0]).div(await cakeMaxiWorkerNative.totalShare())
          expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.320072899420445077'))
          expect(await cakeMaxiWorkerNative.shares(1)).to.eq(bobShare)
          expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(1))).to.eq(bobBalance)
          expect(await cakeMaxiWorkerNative.shareToBalance(await cakeMaxiWorkerNative.shares(0))).to.eq(aliceBalance)
          // after reinvested, bob transfer and work once again, making the block advances by 2 this reward balance will be 0.1*2
          Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.2').toString())
        })
      })
    })
    context("When integrated with an actual vault", async () => {
      it('should reinvest with updated beneficial vault reward to the beneficial vault', async () => {
        await integratedCakeMaxiWorker.setBeneficialVaultBountyBps(BigNumber.from(BENEFICIALVAULT_BOUNTY_BPS))
        expect(await integratedCakeMaxiWorker.beneficialVaultBountyBps()).to.eq(BigNumber.from(BENEFICIALVAULT_BOUNTY_BPS))
        // alice deposit some portion of her native bnb into a vault, thus interest will be accrued afterward
        await integratedVaultAsAlice.deposit(ethers.utils.parseEther('1'), {
          value: ethers.utils.parseEther('1')
        })
        // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB (0.05 as principal amount, 0.05 as a loan)
        // amountOut of 0.1 will be
        // if 1WBNB = 0.1 FToken
        // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1 + 0.1 * 0.9975) = 0.009070243237099340
        await integratedVaultAsAlice.work(
          0,
          integratedCakeMaxiWorker.address,
          ethers.utils.parseEther('0.05'),
          ethers.utils.parseEther('0.05'),
          '0', // max return = 0, don't return BTOKEN to the debt
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          ),
          {
            value: ethers.utils.parseEther('0.05')
          }
        )
        let userInfo = await masterChef.userInfo(0, integratedCakeMaxiWorker.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        expect(await integratedCakeMaxiWorker.shares(1)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        expect(await integratedCakeMaxiWorker.shareToBalance(await integratedCakeMaxiWorker.shares(1))).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        // Alice uses AddBaseTokenOnly strategy to add another 0.1 WBNB
        // amountOut of 0.1 will be
        // if 1.1 WBNB = (0.1 - 0.00907024323709934) FToken
        // if 1.1 WBNB = 0.09092975676290066 FToken
        // 0.1 WBNB will be (0.1 * 0.9975 * 0.09092975676290066) / (1.1 + 0.1 * 0.9975) = 0.0075601110540523785
        // thus, the current amount accumulated with the previous one will be 0.0075601110540523785 + 0.009070243237099340
        // = 0.01663035429115172
        await integratedVaultAsAlice.work(
          1,
          integratedCakeMaxiWorker.address,
          ethers.utils.parseEther('0.1'),
          ethers.utils.parseEther('0'),
          '0', // max return = 0, don't return BTOKEN to the debt
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          ),
          {
            value: ethers.utils.parseEther('0.1')
          }
        )
        // after all these steps above, alice will have a balance in total of 0.016630354291151718 
        userInfo = await masterChef.userInfo(0, integratedCakeMaxiWorker.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        expect(await integratedCakeMaxiWorker.shares(1)).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        Assert.assertAlmostEqual((await integratedCakeMaxiWorker.rewardBalance()).toString(), ethers.utils.parseEther('0.1').toString())
        expect(await integratedCakeMaxiWorker.shareToBalance(await integratedCakeMaxiWorker.shares(1))).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        // total bounty will be 0.2 * 1% = 0.002
        // 90% if reinvest bounty 0.002 * 90 / 100 = 0.0018
        // thus, alice we get a bounty of 0.0018
        // 10% of 0.002 (0.0002) will be distributed to the vault by swapping 0.002 of reward token into a beneficial vault token (this is scenario, it will be ALPACA)
        // if (0.1 - (0.00907024323709934 + 0.0075601110540523785)) FToken = 1.2 WBNB
        // 0.08336964570884828 FToken = 1.2 WBNB
        // 0.0002 will be (0.0002 * 0.9975 * 1.2) / (0.08336964570884828  + 0.0002 * 0.9975) = 0.0028646936374587396 WBNB
        // thus, 0.0028646936374587396 will be sent to integrated Vault
        userInfo = await masterChef.userInfo(0, integratedCakeMaxiWorker.address)
        const beforeVaultTotalToken = await integratedVault.totalToken()
        await integratedCakeMaxiWorkerAsEve.reinvest()
        const afterVaultTotalToken = await integratedVault.totalToken()
        Assert.assertAlmostEqual(afterVaultTotalToken.sub(beforeVaultTotalToken).toString(), ethers.utils.parseEther('0.002864693637458739').toString())
        Assert.assertAlmostEqual((await cake.balanceOf(await eve.getAddress())).toString(), ethers.utils.parseEther('0.0018').toString())
        userInfo = await masterChef.userInfo(0, integratedCakeMaxiWorker.address)
        // Bob start opening his position using 0.1 wbnb
        // amountOut of 0.1 will be
        // if (1.2 - 0.0028646936374587396) WBNB = (0.1 - (0.00907024323709934 + 0.0075601110540523785) + 0.0002) FToken
        // if 1.1971353063625412 WBNB = 0.08356964570884828 FToken
        // 0.1 WBNB will be (0.1 * 0.9975 * 0.08356964570884828) / (1.1971353063625412 + 0.1 * 0.9975) = 0.006427763595254496
        // total farming token amount will be 0.016630354291151718 + 0.006427763595254496 + 0.1*2 from block reward - 0.1*2*0.01 deducted from bounty = 0.22105811788640622
        const bobShare = ethers.utils.parseEther('0.006427763595254496').mul(await integratedCakeMaxiWorker.totalShare()).div(userInfo[0])
        const aliceShare = ethers.utils.parseEther('0.016630354291151718') // no need to readjust the LP balance since this happened before the reinvest
        await integratedVaultAsBob.work(
          0,
          integratedCakeMaxiWorker.address,
          ethers.utils.parseEther('0.1'),
          ethers.utils.parseEther('0'),
          '0', // max return = 0, don't return BTOKEN to the debt
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          ),
          {
            value: ethers.utils.parseEther('0.1')
          }
        )
        userInfo = await masterChef.userInfo(0, integratedCakeMaxiWorker.address)
        const bobBalance = bobShare.mul(userInfo[0]).div(await integratedCakeMaxiWorker.totalShare())
        const aliceBalance = aliceShare.mul(userInfo[0]).div(await integratedCakeMaxiWorker.totalShare())
        Assert.assertAlmostEqual(userInfo[0].toString(), ethers.utils.parseEther('0.22105811788640622').toString())
        Assert.assertAlmostEqual((await integratedCakeMaxiWorker.shares(2)).toString(), bobShare.toString())
        Assert.assertAlmostEqual((await integratedCakeMaxiWorker.shareToBalance(await integratedCakeMaxiWorker.shares(2))).toString(), bobBalance.toString())
        Assert.assertAlmostEqual((await integratedCakeMaxiWorker.shareToBalance(await integratedCakeMaxiWorker.shares(1))).toString(), aliceBalance.toString())
        // after reinvested, bob transfer and work once again, making the block advances by 2 this reward balance will be 0.1*1
        Assert.assertAlmostEqual((await integratedCakeMaxiWorker.rewardBalance()).toString(), ethers.utils.parseEther('0.1').toString())
      })
    })
  })

  describe("#health()", async() => {
    context("When the worker is not a native", async () => {
      it("should convert CAKE(FarmingToken) back to Base Token with a correct amount out", async () => {
        // Pretend that this transfer statement is from the vault
        await baseTokenAsAlice.transfer(cakeMaxiWorkerNonNative.address, ethers.utils.parseEther('0.1'));
        // Alice uses AddBaseTokenOnly strategy to add 0.1 BASE
        // amountOut of 0.1 will be
        // if 1 BASE = 1 BNB
        // 0.1 BASE will be (0.1 * 0.9975 * 1) / (1 + 0.1 * 0.9975) = 0.09070243237099342 BNB
        // if 1 BNB = 0.1 FTOKEN
        // 0.09070243237099342 BNB = (0.09070243237099342 * 0.9975) * (0.1 / (1 + 0.09070243237099342 * 0.9975)) = 0.008296899991192416 FTOKEN
        await cakeMaxiWorkerNonNativeAsAlice.work(
          0, await alice.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
          ['address', 'bytes'],
          [stratAdd.address, ethers.utils.defaultAbiCoder.encode(
            ['uint256'],
            ['0']
          )],
          )
        );
        let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNonNativeAsAlice.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.008296899991192416'))
        expect(await cakeMaxiWorkerNonNativeAsAlice.shares(0)).to.eq(ethers.utils.parseEther('0.008296899991192416'))
        // if  0.091703100008807584 FTOKEN = 1.090702432370993407 BNB
        // 0.008296899991192416 FTOKEN = (0.008296899991192416 * 0.9975) * (1.090702432370993407 / (0.091703100008807584 + 0.008296899991192416 * 0.9975)) = 0.09028698134165357 BNB
        // if  0.909297567629006593 BNB = 1.1 BaseToken
        // 0.09028698134165357 BNB = (0.09028698134165357 * 0.9975) * (1.1 / (0.909297567629006593 + 0.09028698134165357 * 0.9975)) = 0.09913094991787623
        // thus, calling health should return 0.099130949917876232
        let health = await cakeMaxiWorkerNonNativeAsAlice.health(0)
        expect(health).to.eq(ethers.utils.parseEther('0.099130949917876232'))
      })
    })
    context("When the worker is native", async () => {
      it("should convert CAKE(FarmingToken) back to Base Token with a correct amount out", async () => {
        // Alice transfer 0.1 WBNB to StrategyAddBaseTokenOnly first
        await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
        // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB
        // amountOut of 0.1 will be
        // if 1WBNB = 0.1 FToken
        // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1 + 0.1 * 0.9975) = 0.00907024323709934
        await cakeMaxiWorkerNativeAsAlice.work(
          0, await alice.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
          ['address', 'bytes'],
          [stratAdd.address, ethers.utils.defaultAbiCoder.encode(
            ['uint256'],
            ['0']
          )],
          )
        );
        let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        // if  0.1  - 0.00907024323709934 FTOKEN = 1.1 BNB
        // if 0.09092975676290066 FTOKEN = 1.1 BNB
        // 0.00907024323709934 FTOKEN = (0.00907024323709934 * 0.9975) * (1.1 / (0.09092975676290066 + 0.00907024323709934 * 0.9975)) = 0.0995458165383035 BNB
        // thus, calling health should return 0.099545816538303460
        let health = await cakeMaxiWorkerNative.health(0)
        expect(health).to.eq(ethers.utils.parseEther('0.099545816538303460'))
      })
    })
  })

  describe("#liquidate()", async () => {
    it('should liquidate a position based on the share of a user', async () => {
      // sending 0.1 wbnb to the worker (let's pretend to be the value from the vault)
      // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB
      // amountOut of 0.1 will be
      // if 1WBNB = 0.1 FToken
      // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1 + 0.1 * 0.9975) = 0.009070243237099340
      await wbnbTokenAsAlice.transfer(cakeMaxiWorkerNative.address, ethers.utils.parseEther('0.1'));
      const aliceBaseTokenBefore = await wbnb.balanceOf(await alice.getAddress())
      const aliceFarmingTokenBefore = await cake.balanceOf(await alice.getAddress())
      await cakeMaxiWorkerNativeAsAlice.work(
        0, await alice.getAddress(), 0,
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'bytes'],
          [stratAdd.address, 
            ethers.utils.defaultAbiCoder.encode(
              ['uint256'],
              [ethers.utils.parseEther('0')]
            )
          ],
        )
      )
      let userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
      expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
      expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
      // Alice call liquidate strategy to close her position
      await cakeMaxiWorkerNativeAsAlice.liquidate(0)
      // alice will get a base token based on 0.00907024323709934 farming token (staked balance)
      // if  0.1  - 0.00907024323709934 FTOKEN = 1.1 BNB
      // if 0.09092975676290066 FTOKEN = 1.1 BNB
      // 0.00907024323709934 FTOKEN = (0.00907024323709934 * 0.9975) * (1.1 / (0.09092975676290066 + 0.00907024323709934 * 0.9975)) = 0.0995458165383035 BNB
      // thus, alice should get a baseToken amount of 0.099545816538303460
      userInfo = await masterChef.userInfo(0, cakeMaxiWorkerNative.address)
      const aliceBaseTokenAfter = await wbnb.balanceOf(await alice.getAddress())
      const aliceFarmingTokenAfter = await cake.balanceOf(await alice.getAddress())
      expect(userInfo[0]).to.eq(ethers.utils.parseEther('0'))
      expect(await cakeMaxiWorkerNative.shares(0)).to.eq(ethers.utils.parseEther('0'))
      Assert.assertAlmostEqual((await cakeMaxiWorkerNative.rewardBalance()).toString(), ethers.utils.parseEther('0.1').toString())
      expect(aliceBaseTokenAfter.sub(aliceBaseTokenBefore)).to.eq(ethers.utils.parseEther('0.099545816538303460'))
      expect(aliceFarmingTokenAfter.sub(aliceFarmingTokenBefore)).to.eq(ethers.utils.parseEther('0'))
    })

    context("When integrated with an actual vault", async () => {
      it('should successfully liquidate a certain position after all transactions', async () => {
        await integratedCakeMaxiWorker.setBeneficialVaultBountyBps(BigNumber.from(BENEFICIALVAULT_BOUNTY_BPS))
        expect(await integratedCakeMaxiWorker.beneficialVaultBountyBps()).to.eq(BigNumber.from(BENEFICIALVAULT_BOUNTY_BPS))
        // alice deposit some portion of her native bnb into a vault, thus interest will be accrued afterward
        await integratedVaultAsAlice.deposit(ethers.utils.parseEther('1'), {
          value: ethers.utils.parseEther('1')
        })
        // Alice uses AddBaseTokenOnly strategy to add 0.1 WBNB (0.05 as principal amount, 0.05 as a loan)
        // amountOut of 0.1 will be
        // if 1WBNB = 0.1 FToken
        // 0.1WBNB will be (0.1 * 0.9975 * 0.1) / (1 + 0.1 * 0.9975) = 0.009070243237099340
        await integratedVaultAsAlice.work(
          0,
          integratedCakeMaxiWorker.address,
          ethers.utils.parseEther('0.05'),
          ethers.utils.parseEther('0.05'),
          '0', // max return = 0, don't return BTOKEN to the debt
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          ),
          {
            value: ethers.utils.parseEther('0.05')
          }
        )
        let userInfo = await masterChef.userInfo(0, integratedCakeMaxiWorker.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        expect(await integratedCakeMaxiWorker.shares(1)).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        expect(await integratedCakeMaxiWorker.shareToBalance(await integratedCakeMaxiWorker.shares(1))).to.eq(ethers.utils.parseEther('0.00907024323709934'))
        // Alice uses AddBaseTokenOnly strategy to add another 0.1 WBNB
        // amountOut of 0.1 will be
        // if 1.1 WBNB = (0.1 - 0.00907024323709934) FToken
        // if 1.1 WBNB = 0.09092975676290066 FToken
        // 0.1 WBNB will be (0.1 * 0.9975 * 0.09092975676290066) / (1.1 + 0.1 * 0.9975) = 0.0075601110540523785
        // thus, the current amount accumulated with the previous one will be 0.0075601110540523785 + 0.009070243237099340
        // = 0.01663035429115172
        await integratedVaultAsAlice.work(
          1,
          integratedCakeMaxiWorker.address,
          ethers.utils.parseEther('0.1'),
          ethers.utils.parseEther('0'),
          '0', // max return = 0, don't return BTOKEN to the debt
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [stratAdd.address, 
              ethers.utils.defaultAbiCoder.encode(
                ['uint256'],
                [ethers.utils.parseEther('0')]
              )
            ],
          ),
          {
            value: ethers.utils.parseEther('0.1')
          }
        )
        // after all these steps above, alice will have a balance in total of 0.016630354291151718 
        userInfo = await masterChef.userInfo(0, integratedCakeMaxiWorker.address)
        expect(userInfo[0]).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        expect(await integratedCakeMaxiWorker.shares(1)).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        Assert.assertAlmostEqual((await integratedCakeMaxiWorker.rewardBalance()).toString(), ethers.utils.parseEther('0.1').toString())
        expect(await integratedCakeMaxiWorker.shareToBalance(await integratedCakeMaxiWorker.shares(1))).to.eq(ethers.utils.parseEther('0.016630354291151718'))
        // total bounty will be 0.2 * 1% = 0.002
        // 90% if reinvest bounty 0.002 * 90 / 100 = 0.0018
        // thus, alice we get a bounty of 0.0018
        // 10% of 0.002 (0.0002) will be distributed to the vault by swapping 0.002 of reward token into a beneficial vault token (this is scenario, it will be ALPACA)
        // if (0.1 - (0.00907024323709934 + 0.0075601110540523785)) FToken = 1.2 WBNB
        // 0.08336964570884828 FToken = 1.2 WBNB
        // 0.0002 FToken will be (0.0002 * 0.9975 * 1.2) / (0.08336964570884828  + 0.0002 * 0.9975) = 0.0028646936374587396 WBNB
        // thus, 0.0028646936374587396 will be sent to integrated Vault
        userInfo = await masterChef.userInfo(0, integratedCakeMaxiWorker.address)
        const beforeVaultTotalToken = await integratedVault.totalToken()
        await integratedCakeMaxiWorkerAsEve.reinvest()
        const afterVaultTotalToken = await integratedVault.totalToken()
        Assert.assertAlmostEqual(afterVaultTotalToken.sub(beforeVaultTotalToken).toString(), ethers.utils.parseEther('0.002864693637458739').toString())
        Assert.assertAlmostEqual((await cake.balanceOf(await eve.getAddress())).toString(), ethers.utils.parseEther('0.0018').toString())
        // Now it's a liquidation part
        await cakeAsAlice.approve(routerV2.address, constants.MaxUint256)
        // alice buy wbnb so that the price will be fluctuated, so that the position can be liquidated
        await routerV2AsAlice.swapTokensForExactETH(ethers.utils.parseEther('1'), constants.MaxUint256, [cake.address, wbnb.address], await alice.getAddress(), FOREVER)
        // set interest rate to be 0 to be easy for testing.
        await simpleVaultConfig.setParams(
          MIN_DEBT_SIZE, 0, RESERVE_POOL_BPS, KILL_PRIZE_BPS,
          wbnb.address, wNativeRelayer.address, fairLaunch.address
        )
        // pre calculated left, liquidation reward, health
        const toBeLiquidatedValue = await integratedCakeMaxiWorker.health(1)
        const liquidationBounty = toBeLiquidatedValue.mul(1000).div(10000)
        const bobBalanceBefore = await ethers.provider.getBalance(await bob.getAddress())
        const aliceBalanceBefore = await ethers.provider.getBalance(await alice.getAddress())
        const vaultBalanceBefore = await wbnb.balanceOf(integratedVault.address)
        const vaultDebtVal = await integratedVault.vaultDebtVal()
        const debt = await integratedVault.debtShareToVal((await integratedVault.positions(1)).debtShare)
        const left = toBeLiquidatedValue.sub(liquidationBounty).sub(debt)
        // bob call `kill` alice's position, which is position #1
        await integratedVaultAsBob.kill(
          1,
          {
            gasPrice: 0,
          }
        )
        
        const bobBalanceAfter = await ethers.provider.getBalance(await bob.getAddress())
        const aliceBalanceAfter = await ethers.provider.getBalance(await alice.getAddress())
        const vaultBalanceAfter = await wbnb.balanceOf(integratedVault.address)
        expect(bobBalanceAfter.sub(bobBalanceBefore)).to.eq(liquidationBounty) // bob should get liquidation reward
        expect(aliceBalanceAfter.sub(aliceBalanceBefore)).to.eq(left) // alice should get her left back
        expect(vaultBalanceAfter.sub(vaultBalanceBefore)).to.eq(vaultDebtVal) // vault should get it's deposit value back
        expect((await integratedVaultAsAlice.positions(1)).debtShare).to.eq(0)
      })
    })
  })

  describe("#setBeneficialVaultBountyBps", async() => {
    context('When the caller is not an owner', async () => {
      it('should be reverted', async() => {
        await expect(cakeMaxiWorkerNonNativeAsAlice.setBeneficialVaultBountyBps(BigNumber.from('1000'))).to.reverted
      })
    })
    context('When the _beneficialVaultBountyBps > 10000 (100%)', async() => {
      it('should be reverted', async() => {
        await expect(cakeMaxiWorkerNonNative.setBeneficialVaultBountyBps(BigNumber.from('10001'))).to.revertedWith('CakeMaxiWorker::setBeneficialVaultBountyBps:: _beneficialVaultBountyBps exceeds 100%')
      })
    })

    context('when the param is correct', async () => {
      it('should successfully set the beneficial vault bounty bps', async () => {
        expect(await cakeMaxiWorkerNonNative.beneficialVaultBountyBps()).to.eq(BigNumber.from('0'))
        await expect(cakeMaxiWorkerNonNative.setBeneficialVaultBountyBps(BigNumber.from('10000'))).not.to.revertedWith('CakeMaxiWorker::setBeneficialVaultBountyBps:: _beneficialVaultBountyBps exceeds 100%')
        expect(await cakeMaxiWorkerNonNative.beneficialVaultBountyBps()).to.eq(BigNumber.from('10000'))
        await expect(cakeMaxiWorkerNonNative.setBeneficialVaultBountyBps(BigNumber.from('5000'))).not.to.revertedWith('CakeMaxiWorker::setBeneficialVaultBountyBps:: _beneficialVaultBountyBps exceeds 100%')
        expect(await cakeMaxiWorkerNonNative.beneficialVaultBountyBps()).to.eq(BigNumber.from('5000'))
      })
    })
  })
})