use json_parser::JSON8kb;

global MAX_FILLS: u32 = 32;

pub fn assert_allowed_coin(coin: BoundedVec<u8, 16>) {
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

  let is_allowed: bool = is_btc | is_eth | is_sol | is_xrp | is_bnb | is_link;

  assert(is_allowed);
}

pub fn assert_valid_time(time: u64, min_time: u64, max_time: u64) {
  assert(time >= min_time);
  assert(time <= max_time);
}

pub fn validate_fill(fill: JSON8kb, min_time: u64, max_time: u64) {
  let coin: BoundedVec<u8, 16> = fill.get_string_unchecked("coin".as_bytes());
  let time: u64 = fill.get_number_unchecked("time".as_bytes());

  assert_allowed_coin(coin);
  assert_valid_time(time, min_time, max_time);
}

pub fn validate_fills(
  raw_fills: [u8; 8192],
  fill_count: u32,
  min_time: u64,
  max_time: u64
) {
  assert(fill_count <= MAX_FILLS);
  assert(min_time <= max_time);

  let json: JSON8kb = JSON8kb::parse_json(raw_fills);

  for i in 0..MAX_FILLS {
    if (i as u32) < fill_count {
      let fill = json.get_object_from_array_unchecked(i as Field);
      validate_fill(fill, min_time, max_time);
    }
  }
}