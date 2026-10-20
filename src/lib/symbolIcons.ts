import adaIcon from '../assets/icons/markets/ADA.svg'
import americaIcon from '../assets/icons/markets/america.svg'
import australiaIcon from '../assets/icons/markets/australia.svg'
import avaxIcon from '../assets/icons/markets/AvaX.svg'
import bnbIcon from '../assets/icons/markets/bnb.svg'
import btcIcon from '../assets/icons/markets/btc.svg'
import canadaIcon from '../assets/icons/markets/canada.svg'
import chinaIcon from '../assets/icons/markets/china.svg'
import dogeIcon from '../assets/icons/markets/doge.svg'
import dotIcon from '../assets/icons/markets/DOT.svg'
import englandIcon from '../assets/icons/markets/england.svg'
import ethIcon from '../assets/icons/markets/eth.svg'
import euroIcon from '../assets/icons/markets/euro.svg'
import goldIcon from '../assets/icons/markets/gold.svg'
import japanIcon from '../assets/icons/markets/japan.svg'
import linkIcon from '../assets/icons/markets/LINK.svg'
import ltcIcon from '../assets/icons/markets/LTC.svg'
import mexicanIcon from '../assets/icons/markets/mexican.svg'
import newzealandIcon from '../assets/icons/markets/newzealand.svg'
import pepeIcon from '../assets/icons/markets/PEPE.svg'
import platinumIcon from '../assets/icons/markets/platinium.svg'
import shibIcon from '../assets/icons/markets/Shib.svg'
import silverIcon from '../assets/icons/markets/silver.svg'
import solIcon from '../assets/icons/markets/sol.svg'
import swissIcon from '../assets/icons/markets/swiss.svg'
import suiIcon from '../assets/icons/markets/SUI.svg'
import tonIcon from '../assets/icons/markets/TON.svg'
import trxIcon from '../assets/icons/markets/TRX.svg'
import turkeyIcon from '../assets/icons/markets/turkey.svg'
import usdtIcon from '../assets/icons/markets/usdt.svg'
import xrpIcon from '../assets/icons/markets/XRP.svg'
import zarIcon from '../assets/icons/markets/ZAR-south-africa.svg'

export const SYMBOL_ICONS: Record<string, readonly string[]> = {
  EUR_USD: [euroIcon, americaIcon],
  GBP_USD: [englandIcon, americaIcon],
  USD_JPY: [americaIcon, japanIcon],
  AUD_USD: [australiaIcon, americaIcon],
  USD_CAD: [americaIcon, canadaIcon],
  USD_CHF: [americaIcon, swissIcon],
  NZD_USD: [newzealandIcon, americaIcon],
  EUR_JPY: [euroIcon, japanIcon],
  GBP_JPY: [englandIcon, japanIcon],
  EUR_GBP: [euroIcon, englandIcon],
  USD_CNH: [americaIcon, chinaIcon],
  AUD_JPY: [australiaIcon, japanIcon],
  EUR_AUD: [euroIcon, australiaIcon],
  EUR_CHF: [euroIcon, swissIcon],
  CAD_JPY: [canadaIcon, japanIcon],
  GBP_AUD: [englandIcon, australiaIcon],
  AUD_NZD: [australiaIcon, newzealandIcon],
  AUD_CAD: [australiaIcon, canadaIcon],
  USD_MXN: [americaIcon, mexicanIcon],
  USD_ZAR: [americaIcon, zarIcon],
  USD_TRY: [americaIcon, turkeyIcon],
  XAU_USD: [goldIcon, americaIcon],
  XAG_USD: [silverIcon, americaIcon],
  XPT_USD: [platinumIcon, americaIcon],
  BTC_USDT: [btcIcon, usdtIcon],
  ETH_USDT: [ethIcon, usdtIcon],
  BNB_USDT: [bnbIcon, usdtIcon],
  SOL_USDT: [solIcon, usdtIcon],
  XRP_USDT: [xrpIcon, usdtIcon],
  DOGE_USDT: [dogeIcon, usdtIcon],
  ADA_USDT: [adaIcon, usdtIcon],
  SUI_USDT: [suiIcon, usdtIcon],
  TRX_USDT: [trxIcon, usdtIcon],
  LINK_USDT: [linkIcon, usdtIcon],
  AVAX_USDT: [avaxIcon, usdtIcon],
  TON_USDT: [tonIcon, usdtIcon],
  LTC_USDT: [ltcIcon, usdtIcon],
  DOT_USDT: [dotIcon, usdtIcon],
  SHIB_USDT: [shibIcon, usdtIcon],
  PEPE_USDT: [pepeIcon, usdtIcon],
}

export function getSymbolIcons(symbol: string) {
  return SYMBOL_ICONS[symbol] ?? [americaIcon]
}
