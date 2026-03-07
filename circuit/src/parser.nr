use dep::json_parser::JSON8kb;
global MAX_FILLS:Field = 32;

pub fn assert_allowed_coin(coin: BoundedVec<u8, 16>) {
  let btc = BoundedVec::from_array("BTC".as_array());
  let eth = BoundedVec::from_array("ETH".as_array());
  let sol = BoundedVec::from_array("SOL".as_array());
  let xrp = BoundedVec::from_array("XRP".as_array());
  let bnb = BoundedVec::from_array("BNB".as_array());
  let link = BoundedVec::from_array("LINK".as_array());

  let is_allowed =
    coin == btc ||
    coin == eth ||
    coin == sol ||
    coin == xrp ||
    coin == bnb ||
    coin == link;

  assert(is_allowed);
}

pub fn assert_valid_time(time: u64, min_time: u64, max_time: u64) {
  assert(time >= min_time);
  assert(time <= max_time);
}

pub fn validate_fill(fill: JSON8kb, min_time: u64, max_time: u64) {
  let coin: BoundedVec<u8, 16> = fill.get_string_unchecked("coin".as_array());
  let time: u64 = fill.get_number_unchecked("time");

  assert_allowed_coin(coin);
  assert_valid_time(time, min_time, max_time);
}

pub fn validate_fills(raw_fills: [u8; 1024], fill_count: u32, min_time: u64, max_time: u64) {
  assert(fill_count <= MAX_FILLS);

  let json: JSON8kb = JSON8kb::parse_json(raw_fills);

  for i in 0..MAX_FILLS {
    if (i as u32) < fill_count {
      let fill: JSON8kb = json.get_object_as_array_unchecked(i);
      validate_fill(fill, min_time, max_time);
    }
  }
}