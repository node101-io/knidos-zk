use json_parser::JSON8kb;

global MAX_FILLS: u32 = 32;

pub fn assertAllowedCoin(coin: BoundedVec<u8, 16>) {
  let btc = BoundedVec::from_array("BTC".as_bytes());
  let eth = BoundedVec::from_array("ETH".as_bytes());
  let sol = BoundedVec::from_array("SOL".as_bytes());
  let xrp = BoundedVec::from_array("XRP".as_bytes());
  let bnb = BoundedVec::from_array("BNB".as_bytes());
  let link = BoundedVec::from_array("LINK".as_bytes());
  let hype = BoundedVec::from_array("@1035".as_bytes());

  let is_btc: bool = coin == btc;
  let is_eth: bool = coin == eth;
  let is_sol: bool = coin == sol;
  let is_xrp: bool = coin == xrp;
  let is_bnb: bool = coin == bnb;
  let is_link: bool = coin == link;
  let is_hype: bool = coin == hype;

  let is_allowed: bool = is_btc | is_eth | is_sol | is_xrp | is_bnb | is_link | is_hype;

  assert(is_allowed);
}

pub fn assertValidTime(time: u64, min_time: u64, max_time: u64) {
  assert(time >= min_time);
  assert(time <= max_time);
}

pub fn trimRawFills(
  raw: [u8; 8192],
  length: u32
) -> [u8; 8192] {

  let mut out: [u8; 8192] = [0; 8192];

  for i in 0..8192 {
    if (i as u32) < length {
      out[i] = raw[i];
    } else {
      // replace padding with whitespace
      out[i] = 32; // ' '
    }
  }

  out
}

pub fn stringToSignedInteger1e6(string: BoundedVec<u8, 16>) -> (i64) {
  let mut isNegative = false;

  if(string.get_unchecked(0) == 45){  //ASCI character for -
    isNegative = true;
  }

  let stringLen = string.len();
  let mut pointPosition: u32 = 0;
  let mut totalNumber: i64 = 0;

  for i in 0..stringLen {
    if (string.get_unchecked(i) == 46) {
      pointPosition = i;
    }
  }
  assert (pointPosition < stringLen);

  if (isNegative) {
    for i in 1..pointPosition {
    let asciiToDigit = string.get_unchecked(i) - 48;
    let digit: i64 = asciiToDigit as i64 * (10 ^ ((pointPosition as i64 ) - 1 - (i as i64) + 6));
    totalNumber += digit;
    }
  }
  else {
    for i in 0..pointPosition {
      let asciiToDigit = string.get_unchecked(i) - 48;
      let digit: i64 = asciiToDigit as i64 * (10 ^ ((pointPosition as i64 ) - 1 - (i as i64) + 6));
      totalNumber += digit;
    }
  }

  for i in (pointPosition + 1)..stringLen {
    let asciiToDigit = string.get_unchecked(i) - 48;
    let fraction: i64 = asciiToDigit as i64 * (10 ^ (6 - i as i64));
    totalNumber += fraction;
  }
  if(isNegative) {
    totalNumber = totalNumber * -1;
  }

  totalNumber
}

pub fn calculateChecksum(fill: JSON8kb) -> (i64){
  let closedPnlString = fill.get_string_unchecked("closedPnl".as_bytes());
  let feeString = fill.get_string_unchecked("fee".as_bytes());

  let closedPnlNumber = stringToSignedInteger1e6(closedPnlString);
  let feeNumber = stringToSignedInteger1e6(feeString);
  let profit = closedPnlNumber - feeNumber;
  profit
}

pub fn validateChecksum (baseBalance:i64, totalProfit: i64, threshold: i64) {
  let finalBalance = baseBalance + totalProfit;
  assert(finalBalance > threshold);
}

pub fn validateTimeAndCoinOneFill (fill: JSON8kb, min_time: u64, max_time: u64){
  let coin: BoundedVec<u8, 16> = fill.get_string_unchecked("coin".as_bytes());
  let time: u64 = fill.get_number_unchecked("time".as_bytes());

  assertAllowedCoin(coin);
  assertValidTime(time, min_time, max_time);
}

pub fn validateFills(
  raw_fills: [u8; 8192],
  raw_fills_lenght: u32,
  fill_count: u32,
  min_time: u64,
  max_time: u64,
  baseBalance: i64,
  threshold: i64
) {
  assert(fill_count <= MAX_FILLS);
  assert(min_time <= max_time);

  let cleaned_raw = trimRawFills(raw_fills, raw_fills_lenght);
  let json: JSON8kb = JSON8kb::parse_json(cleaned_raw);
  let mut totalProfit: i64 = 0;

  for i in 0..MAX_FILLS {
    if (i as u32) < fill_count {
      let fill = json.get_object_from_array_unchecked(i as Field);
      validateTimeAndCoinOneFill(fill, min_time, max_time);
      let oneFillChecksum = calculateChecksum(fill);
      totalProfit += oneFillChecksum;
    }
  }
  validateChecksum(baseBalance, totalProfit, threshold);
}