use json_parser::JSON8kb;

// JSON8kb allows 1024 tokens and a Hyperliquid fill costs ~60, so the parser
// tokenises at most 16 fills (measured: 16 parse, 17 fail). Iterating past
// that only adds constraints for slots that can never be populated. Mirrored
// in packages/zk-node/src/shared/circuit-limits.ts.
global MAX_FILLS: u32 = 16;
global MAX_STRING_LENGHT: u32 = 16;
global DECIMAL_SCALE: i64 = 100000000;
global MAX_FRACTION_DIGITS: u32 = 8;
global MAX_INTEGER_DIGITS: u32 = 10;

fn isAllowedCoin(coin: BoundedVec<u8, 16>) -> bool {
  let btc = BoundedVec::from_array("BTC".as_bytes());
  let eth = BoundedVec::from_array("ETH".as_bytes());
  let sol = BoundedVec::from_array("SOL".as_bytes());
  let xrp = BoundedVec::from_array("XRP".as_bytes());
  let bnb = BoundedVec::from_array("BNB".as_bytes());
  let link = BoundedVec::from_array("LINK".as_bytes());

  let is_btc: bool = coin == btc;
  let is_eth: bool = coin == eth;
  let is_sol: bool = coin == sol;
  let is_xrp: bool = coin == xrp;
  let is_bnb: bool = coin == bnb;
  let is_link: bool = coin == link;

  is_btc | is_eth | is_sol | is_xrp | is_bnb | is_link
}

// `closedPnl` is always quoted in USDC, but `fee` is charged in whatever
// `feeToken` names -- measured on mainnet as USDC 99.6% / USDE 0.4% for perps,
// and in the traded asset (e.g. HYPE) for spot. Subtracting a fee denominated
// in anything but a dollar-pegged token would mix units, so the fill is only
// treated as valid when feeToken is one we know sits at $1.
fn isDollarPeggedFeeToken(feeToken: BoundedVec<u8, 16>) -> bool {
  let usdc = BoundedVec::from_array("USDC".as_bytes());
  let usde = BoundedVec::from_array("USDE".as_bytes());

  let is_usdc: bool = feeToken == usdc;
  let is_usde: bool = feeToken == usde;

  is_usdc | is_usde
}

fn isValidTime(time: u64, min_time: u64, max_time: u64) -> bool {
  (time >= min_time) & (time <= max_time)
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

pub fn stringToSignedInteger1e8(string: BoundedVec<u8, 16>) -> (i64, bool) {
  let bytes = string.storage();
  let stringLen = string.len();
  let mut valid = stringLen > 0;
  let mut isNegative = false;
  let mut pointPosition: u32 = MAX_STRING_LENGHT;
  let mut digitsBeforePoint: u32 = 0;
  let mut digitsAfterPoint: u32 = 0;
  let mut integerPart: i64 = 0;
  let mut fractionPart: i64 = 0;

  for i in 0..MAX_STRING_LENGHT {
    let active = (i as u32) < stringLen;
    let byte = bytes[i];
    let isMinus = byte == 45;
    let isDot = byte == 46;
    let isDigit = (byte >= 48) & (byte <= 57);
    valid = valid & (!active | isMinus | isDot | isDigit);
    valid = valid & (!active | !isMinus | (i == 0));

    if active & isMinus & (i == 0) {
      isNegative = true;
    }

    if active & isDot {
      valid = valid & (pointPosition == MAX_STRING_LENGHT);
      if pointPosition == MAX_STRING_LENGHT {
        pointPosition = i as u32;
      }
    }
  }

  let startPosition: u32 = if isNegative {1} else {0};
  let hasPoint = pointPosition < stringLen;
  let integerEnd = if hasPoint { pointPosition } else { stringLen };
  valid = valid & (startPosition < integerEnd);

  for i in 0..MAX_STRING_LENGHT {
    let inIntegerPart =
      ((i as u32) >= startPosition) & ((i as u32) < integerEnd) & ((i as u32) < stringLen);
    let byte = bytes[i];
    let isDigit = (byte >= 48) & (byte <= 57);
    let digit = (byte as i64) - 48;
    valid = valid & (!inIntegerPart | isDigit);

    if inIntegerPart & isDigit & (digitsBeforePoint < MAX_INTEGER_DIGITS) {
      integerPart = integerPart * 10 + digit;
    }

    digitsBeforePoint += (inIntegerPart & isDigit) as u32;
  }

  for i in 0..MAX_STRING_LENGHT {
    let inFractionPart = ((i as u32) > pointPosition) & ((i as u32) < stringLen);
    let byte = bytes[i];
    let isDigit = (byte >= 48) & (byte <= 57);
    let digit = (byte as i64) - 48;
    valid = valid & (!inFractionPart | isDigit);

    if inFractionPart & isDigit & (digitsAfterPoint < MAX_FRACTION_DIGITS) {
      fractionPart = fractionPart * 10 + digit;
    }

    digitsAfterPoint += (inFractionPart & isDigit) as u32;
  }

  valid = valid & (digitsBeforePoint > 0) & (digitsBeforePoint <= MAX_INTEGER_DIGITS);
  valid = valid & (!hasPoint | ((digitsAfterPoint > 0) & (digitsAfterPoint <= MAX_FRACTION_DIGITS)));
  valid = valid & (hasPoint | (digitsAfterPoint == 0));

  let mut scaledFractionPart = fractionPart;
  for i in 0..MAX_FRACTION_DIGITS {
    if (i as u32) >= digitsAfterPoint {
      scaledFractionPart *= 10;
    }
  }

  let mut totalNumber = integerPart * DECIMAL_SCALE + scaledFractionPart;

  if(isNegative) {
    totalNumber = totalNumber * -1;
  }

  (totalNumber, valid)
}

pub fn calculateChecksum(fill: JSON8kb) -> (i64, bool) {
  let closedPnlString: Option<BoundedVec<u8, 16>> = fill.get_string("closedPnl".as_bytes());
  let feeString: Option<BoundedVec<u8, 16>> = fill.get_string("fee".as_bytes());
  let feeTokenString: Option<BoundedVec<u8, 16>> = fill.get_string("feeToken".as_bytes());
  let hasClosedPnl = closedPnlString.is_some();
  let hasFee = feeString.is_some();
  let hasFeeToken = feeTokenString.is_some();

  let (closedPnlNumber, closedPnlValid) = stringToSignedInteger1e8(closedPnlString.unwrap_unchecked());
  let (feeNumber, feeValid) = stringToSignedInteger1e8(feeString.unwrap_unchecked());
  let feeTokenAllowed = isDollarPeggedFeeToken(feeTokenString.unwrap_unchecked());

  let profit = closedPnlNumber - feeNumber;
  let valid =
    hasClosedPnl & hasFee & hasFeeToken & closedPnlValid & feeValid & feeTokenAllowed;
  (profit, valid)
}

pub fn validateChecksum (baseBalance:i64, totalProfit: i64, threshold: i64) {
  let finalBalance = baseBalance + totalProfit;
  assert(finalBalance > threshold);
}

pub fn validateTimeAndCoinOneFill(fill: JSON8kb, min_time: u64, max_time: u64) -> bool {
  let coin: Option<BoundedVec<u8, 16>> = fill.get_string("coin".as_bytes());
  let time: Option<u64> = fill.get_number("time".as_bytes());

  let hasCoin = coin.is_some();
  let hasTime = time.is_some();
  let coinValue = coin.unwrap_unchecked();
  let timeValue = time.unwrap_unchecked();
  let coinAllowed = isAllowedCoin(coinValue);
  let timeValid = isValidTime(timeValue, min_time, max_time);

  hasCoin & hasTime & coinAllowed & timeValid
}

pub fn validateFills(
  raw_fills: [u8; 8192],
  raw_fills_lenght: u32,
  min_time: u64,
  max_time: u64,
  baseBalance: i64,
  threshold: i64
) {
  assert(min_time <= max_time);

  let cleaned_raw = trimRawFills(raw_fills, raw_fills_lenght);
  let json: JSON8kb = JSON8kb::parse_json(cleaned_raw);
  let fill_count = json.get_length();
  assert(fill_count <= MAX_FILLS);
  let mut totalProfit: i64 = 0;

  for i in 0..MAX_FILLS {
    let slot_active = (i as u32) < fill_count;
    let maybe_fill = json.get_object_from_array(i as Field);
    assert(maybe_fill.is_some() == slot_active);
    let fill = maybe_fill.unwrap_unchecked();
    let timeAndCoinValid = validateTimeAndCoinOneFill(fill, min_time, max_time);
    let (oneFillChecksum, checksumValid) = calculateChecksum(fill);
    let slotValid = timeAndCoinValid & checksumValid;

    assert((!slot_active) | slotValid);
    totalProfit += oneFillChecksum * (slot_active as u32 as i64);
  }
  validateChecksum(baseBalance, totalProfit, threshold);
}
