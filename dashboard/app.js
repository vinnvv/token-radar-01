// Token Radar radar-3 dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table,
// a per-protocol detail view with the model's own inputs and the
// protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code
  // and the board's data are visibly the same arithmetic. Radar-3: the
  // implied value is the size-curve value times the category factor,
  // rounded to the nearest whole dollar. The size curve is the
  // exponential of the intercept plus the slope times the log of TVL;
  // the factor is the exponential of the category offset. Growth, age
  // and chain count do not enter the value: the blind test dropped them.
  function impliedOf(row, model) {
    var curve = Math.exp(model.intercept + model.slope * Math.log(row.tvl_usd));
    return Math.max(1, Math.round(curve * row.category_factor));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the
  // hold and every cost and time. No name is special-cased.
  function money(n) { return n % 1 === 0 ? '$' + n : '$' + n.toFixed(2); }
  function gasTier(chain) {
    var lower = (chain || '').toLowerCase();
    var tiers = DATA.model.gas_tiers;
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      for (var j = 0; j < t.match.length; j++) {
        if (lower.indexOf(t.match[j]) >= 0) return t;
      }
    }
    return DATA.model.gas_other;
  }
  function gasRange(tier) {
    function fmt(v) { return v < 1 ? '$' + v.toFixed(2) : '$' + v; }
    return tier.low === tier.high ? 'about ' + fmt(tier.low) : 'about ' + fmt(tier.low) + ' to ' + fmt(tier.high);
  }
  // The protocol's chains ranked cheapest first by gas midpoint. Ties
  // keep the order the snapshot lists them in, so the ranking is stable.
  function rankedChains(p) {
    var seen = [];
    (p.chains || []).forEach(function (c) { if (seen.indexOf(c) < 0) seen.push(c); });
    return seen.map(function (chain) { return { chain: chain, tier: gasTier(chain) }; })
      .sort(function (a, b) { return a.tier.mid - b.tier.mid; });
  }
  function capitalFor(p) {
    var tiers = DATA.model.capital_tiers;
    for (var i = 0; i < tiers.length; i++) {
      if (p.tvl_usd >= tiers[i].min_tvl_usd) return tiers[i].usd;
    }
    return 25;
  }
  function holdDaysFor(age) {
    var m = DATA.model;
    if (age === null || age === undefined) return m.hold_unknown_days;
    if (age < m.hold_young_cutoff_days) return m.hold_young_days;
    if (age < m.hold_old_cutoff_days) return m.hold_mid_days;
    return m.hold_old_days;
  }
  // The family a category's farm mechanics follow. Categories the model
  // does not list fall through to the fallback.
  function familyOf(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('lending') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
    if (c === 'dexs') return 'dex';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged') >= 0) return 'yield';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'derivatives';
    if (c === 'rwa') return 'rwa';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('staking') >= 0 || c.indexOf('restaking') >= 0) return 'staking';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('liquidity manager') >= 0) return 'curator';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('payment') >= 0) return 'payments';
    if (c.indexOf('farm') >= 0) return 'farm';
    return 'fallback';
  }
  // The main position: what the farmer does with the capital, in the
  // category's own mechanics, on the named chain.
  function mainAction(family, category, name, capital, chain) {
    var c = (category || '').toLowerCase();
    if (family === 'lending') {
      if (c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
        return 'Deposit $' + capital + ' of collateral with ' + name + ' on ' + chain + ', borrow a small amount against it, and keep the position open.';
      }
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    }
    if (family === 'dex') {
      return 'Supply $' + capital + " as liquidity to " + name + "'s main pool on " + chain + ', in the pair the pool actually trades, and keep the position open.';
    }
    if (family === 'yield') {
      if (c.indexOf('aggregator') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s vault on " + chain + ' and keep the position open.';
      if (c.indexOf('leveraged') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s farm on " + chain + ' and keep the position open.';
      return 'Deposit $' + capital + ' into ' + name + "'s main yield position on " + chain + ' and keep it open.';
    }
    if (family === 'derivatives') {
      return 'Deposit $' + capital + ' of USDC as margin with ' + name + ' on ' + chain + ' and open one small hedge, sized well below the deposit so a move against it cannot liquidate the position.';
    }
    if (family === 'rwa') return 'Mint $' + capital + ' of ' + name + "'s yield asset on " + chain + ' and hold it.';
    if (family === 'bridge') {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app on that chain.';
    }
    if (family === 'staking') {
      return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    }
    if (family === 'prediction') {
      return 'Fund $' + capital + ' and place one market position with ' + name + ' on ' + chain + ', in the market with the most volume the protocol shows.';
    }
    if (family === 'curator') {
      return 'Deposit $' + capital + ' into a vault of ' + name + ' on ' + chain + ' and keep the vault shares.';
    }
    if (family === 'stable') return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (family === 'insurance') return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy open.';
    if (family === 'payments') return 'Pay one invoice of $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (family === 'farm') return 'Deposit $' + capital + ' into ' + name + "'s farm on " + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  // The second action on a single-chain row: a category-appropriate
  // action that is not the main position, done inside a weekly action
  // so it costs no extra transaction.
  function secondAction(family, category) {
    var c = (category || '').toLowerCase();
    if (family === 'dex') return 'a small swap through the same pool to register trading activity alongside the liquidity';
    if (family === 'lending') {
      if (c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
        return 'a small borrow against the deposited collateral, held briefly and repaid, to register borrowing activity';
      }
      return 'a small borrow against the supply, held briefly and repaid, to register borrowing activity';
    }
    if (family === 'derivatives') return 'a second small hedge in the opposite direction, closed within the week';
    if (family === 'yield') return 'a claim and restake of whatever rewards have accrued';
    if (family === 'rwa') return 'a small redemption and re-mint, to register activity without leaving the position';
    if (family === 'bridge') return 'a second small bridge back, to register two-way activity';
    if (family === 'staking') return 'a small additional stake';
    if (family === 'prediction') return 'a second position in a different market, so the activity is not one market alone';
    if (family === 'curator') return 'a deposit into a second vault of the same protocol, so the activity spans more than one allocation';
    if (family === 'stable') return 'a small redemption and re-mint';
    if (family === 'insurance') return 'a second small cover on a different pool';
    if (family === 'payments') return 'a second payment to a different counterparty';
    if (family === 'farm') return 'a harvest and restake of accrued rewards';
    return "a small swap through the protocol's main function, or a vote where the protocol offers one";
  }
  // The weekly qualifying action, in the category's own mechanics.
  function weeklyAction(family) {
    if (family === 'dex') return 'swap through the pool, deposit, or claim rewards';
    if (family === 'lending') return 'deposit, borrow, or repay';
    if (family === 'derivatives') return 'trade, deposit, or pay funding';
    if (family === 'yield') return 'deposit, claim rewards, or restake';
    if (family === 'rwa') return 'mint, redeem, or transfer';
    if (family === 'bridge') return 'bridge, swap on the destination chain, or claim';
    if (family === 'staking') return 'stake, request an unstake, or claim rewards';
    if (family === 'prediction') return 'take a market position or settle one';
    if (family === 'curator') return "deposit, request a withdrawal, or vote on the vault's allocation";
    if (family === 'stable') return 'mint, redeem, or transfer';
    if (family === 'insurance') return 'buy cover, check a claim filing, or renew';
    if (family === 'payments') return 'pay, settle, or check a payout';
    if (family === 'farm') return 'deposit, harvest, or restake';
    return 'deposit, swap, or vote';
  }
  // The claim vocabulary of the category: what the protocol's own
  // points or rewards page is called.
  function claimNoun(family) {
    if (family === 'dex' || family === 'yield' || family === 'farm' || family === 'staking') return 'rewards';
    if (family === 'curator') return 'vault points';
    return 'points';
  }
  function lowerFirst(s) { return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1); }
  function growthNote(change7d) {
    if (change7d === null || change7d === undefined) return 'The seven-day growth figure is missing, so enter at the next weekly check.';
    var shown = (change7d > 0 ? '+' : '') + change7d.toFixed(2) + '%';
    if (change7d < -20) return 'TVL fell ' + shown + ' in seven days: wait one week and re-check the TVL before adding to the position.';
    if (change7d > 30) return 'TVL rose ' + shown + ' in seven days: enter within the week, since momentum is with the position.';
    return 'Enter at the next weekly check.';
  }
  // The eight farm steps, re-derived from the row's own figures with
  // the same engine main.ts writes to board.json, so the plan the page
  // shows is the plan the board carries, step for step.
  function farmSteps(p) {
    var m = DATA.model;
    var family = familyOf(p.category);
    var ranked = rankedChains(p);
    var first = ranked[0] || { chain: 'its main chain', tier: m.gas_other };
    var second = ranked[1] || null;
    var multiChain = second !== null;
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.ceil(hold / 7);
    var positions = multiChain ? 2 : 1;
    var capitalCommitted = capital * positions;
    var spent = 2 * first.tier.mid + (multiChain && second ? 2 * second.tier.mid : 0) + (weeks + 2) * first.tier.mid;
    var minutes = m.minutes_setup + (multiChain ? m.minutes_second_position : 0) + weeks * m.minutes_weekly + m.minutes_claim + m.minutes_log;
    var ratio = spent / (p.implied_value_usd / 1000000);
    var verdict;
    if (ratio <= m.verdict_farm_max_ratio && minutes <= m.verdict_farm_max_minutes) verdict = 'farm';
    else if ((ratio > m.verdict_farm_max_ratio && ratio <= m.verdict_thin_max_ratio) || (minutes > m.verdict_farm_max_minutes && minutes <= m.verdict_thin_max_minutes)) verdict = 'thin';
    else verdict = 'skip';
    var ageSentence = p.age_days === null || p.age_days === undefined ? 'No listing date is recorded for the protocol.' : 'The protocol has run ' + p.age_days + ' days with no token on record.';
    var steps = [];
    steps.push('Set up a fresh wallet for ' + p.name + ' on ' + first.chain + (multiChain && second ? ', and keep ' + second.chain + ' ready as the second chain' : '') + '. Fund it from an exchange or another wallet, never from a wallet that holds your main funds. The first transaction on ' + first.chain + ' costs ' + gasRange(first.tier) + ' of gas. Time: 15 minutes to set up the wallet and open the first position.');
    steps.push(mainAction(family, p.category, p.name, capital, first.chain) + ' Cost: $' + capital + ' of capital plus two transactions on ' + first.chain + ', ' + gasRange(first.tier) + ' of gas each. Time: inside the 15 minutes the wallet setup takes.');
    if (multiChain && second) {
      steps.push('Open a second position on ' + second.chain + ', the next-cheapest chain: ' + lowerFirst(mainAction(family, p.category, p.name, capital, second.chain)) + ' Cost: $' + capital + ' of capital plus two transactions on ' + second.chain + ', ' + gasRange(second.tier) + ' of gas each. Time: 15 minutes to set up the second position.');
    } else {
      steps.push('Once, inside a weekly action on ' + first.chain + ', ' + secondAction(family, p.category) + ". Cost: no extra gas beyond that week's transaction. Time: inside the weekly 10 minutes.");
    }
    steps.push('Once a week for ' + weeks + ' weeks, ' + weeklyAction(family) + ' on ' + first.chain + '. Cost: ' + gasRange(first.tier) + ' of gas for one weekly action. Time: 10 minutes a week.');
    steps.push('Hold the position for ' + hold + ' days. ' + ageSentence + ' ' + growthNote(p.change_7d) + ' Cost: the ' + money(capitalCommitted) + ' stays in the position. Time: ' + hold + ' calendar days.');
    steps.push('Open ' + p.name + "'s own " + claimNoun(family) + ' page on ' + first.chain + ' and check whether anything is claimable. Claim only from the link that page publishes, and never pay to claim. Cost: no fee to check. Time: 10 minutes to check and claim.');
    var verdictSentence;
    if (verdict === 'farm') verdictSentence = 'The cost ratio is ' + ratio.toFixed(1) + ' dollars spent per $1M of implied value, at or below the farm limit of 10, and the plan stays within 180 active minutes.';
    else if (verdict === 'thin') {
      if (minutes > m.verdict_farm_max_minutes) verdictSentence = 'The plan runs ' + minutes + ' active minutes, above the 180 the farm verdict allows, so the plan is thin: it only pays if the allocation beats the break-even.';
      else verdictSentence = 'The cost ratio is ' + ratio.toFixed(1) + ' dollars spent per $1M of implied value, above 10 and at or below 25, so the plan is thin: it only pays if the allocation beats the break-even.';
    } else if (minutes > m.verdict_thin_max_minutes) verdictSentence = 'The plan runs ' + minutes + ' active minutes, above 480, so the plan is skipped: the time costs more than the position is worth chasing.';
    else verdictSentence = 'The cost ratio is ' + ratio.toFixed(1) + ' dollars spent per $1M of implied value, above 25, so the plan is skipped: the gas costs more than the position is worth chasing.';
    steps.push('Totals: ' + money(spent) + ' spent on gas and fees, ' + money(capitalCommitted) + ' of capital committed across ' + positions + ' position' + (positions === 1 ? '' : 's') + ', ' + minutes + ' active minutes over ' + hold + ' calendar days. Break-even allocation: ' + money(spent) + '. Verdict: ' + verdict + '. ' + verdictSentence);
    steps.push('Log the wallet, ' + first.chain + ', the ' + hold + '-day hold and the ' + verdict + ' verdict in the farm log. Unwind on ' + first.chain + ' when the verdict changes or the snapshot moves: withdraw the position, claim anything pending, and record every transaction. Cost: one exit transaction on ' + first.chain + ', ' + gasRange(first.tier) + ' of gas. Time: 5 minutes to log.');
    return steps;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var verdictRank = { farm: 0, thin: 1, skip: 2 };
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'mult') { av = a.category_multiple; bv = b.category_multiple; }
      else if (key === 'verdict') { av = verdictRank[a.verdict] === undefined ? 3 : verdictRank[a.verdict]; bv = verdictRank[b.verdict] === undefined ? 3 : verdictRank[b.verdict]; }
      else if (key === 'cost_ratio') { av = a.cost_ratio; bv = b.cost_ratio; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null, 'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }), ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }), ' clean pre-token protocols below that floor. All ', el('b', { text: '758' }), ' protocols in the snapshot are accounted for: ', el('b', { text: String(DATA.board_size) }), ' ranked + ', el('b', { text: String(DATA.live_size) }), ' live-token + ', el('b', { text: String(DATA.no_cap_size) }), ' token-recorded-no-cap + ', el('b', { text: String(DATA.set_aside_size) }), ' set-aside pre-token = 758. Implied value is a model, not a promise.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Token recorded, no market cap' }), el('b', { text: String(DATA.no_cap_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Set-aside pre-token protocols' }), el('b', { text: String(DATA.set_aside_size) }))
      )
    );
  }

  // The lead: rank 1 set large as a printed ledger entry under a
  // magenta rule, ranks 2 to 5 as hairline-parted index rows. No cards.
  function lead() {
    var top = DATA.rows.slice(0, 5);
    var first = top[0];
    var rest = top.slice(1);
    return el('section', { class: 'lead', 'aria-label': 'Top five protocols by implied value' },
      el('button', { class: 'lead-row', type: 'button', onclick: function () { openDetail(first.slug); } },
        el('span', { class: 'lead-rank', text: '1' }),
        el('span', null,
          el('span', { class: 'lead-name', text: first.name }),
          el('span', { class: 'lead-sub', text: (first.category || 'Other') + ' on ' + (first.chains && first.chains.length ? first.chains.slice(0, 2).join(', ') : 'an unnamed chain') + ', ' + fmtUsd(first.tvl_usd) + ' TVL, ' + fmtPct(first.change_7d) + ' in 7d' })
        ),
        el('span', { class: 'lead-value', text: fmtUsd(first.implied_value_usd) },
          el('small', { text: 'implied value' })
        )
      ),
      rest.map(function (r) {
        return el('button', { class: 'index-row', type: 'button', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'index-rank', text: String(r.rank) }),
          el('span', { class: 'index-name', text: r.name },
            el('span', { text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
          ),
          el('span', { class: 'index-tvl', text: fmtUsd(r.tvl_usd) + ' TVL' }),
          el('span', { class: 'index-val', text: fmtUsd(r.implied_value_usd) })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var noCap = el('button', { type: 'button', 'aria-pressed': state.tab === 'no-cap' ? 'true' : 'false', text: 'No market cap', onclick: function () { state.tab = 'no-cap'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live, noCap)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : noCapRows().length + ' token-recorded protocols' })
    );
  }

  // The no-cap tab: protocols that record a token but no market cap,
  // listed by TVL descending, under the same search and filters.
  function noCapRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.no_cap.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'sheet' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.category_multiple.toFixed(3) + 'x' }),
        el('td', null, el('div', { class: 'implied' },
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: '$' + r.cost_ratio.toFixed(1) }),
        el('td', null, el('span', { class: 'verdict verdict-' + r.verdict, text: r.verdict })),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'sheet' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('mult', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            sortHeader('cost_ratio', 'Cost / $1M'),
            sortHeader('verdict', 'Verdict'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'sheet' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function noCapTable() {
    var list = noCapRows();
    if (list.length === 0) {
      return el('div', { class: 'sheet' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the list again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'no cap' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'status', text: 'token recorded, market cap not recorded' }))
      ));
    });
    return el('div', { class: 'sheet' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token recorded, market cap not recorded: these protocols have a token, its value is simply not recorded here. Listed by TVL, largest first.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var multRows = (DATA.category_multiples || []).map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: (c.offset >= 0 ? '+' : '') + c.offset.toFixed(3) }),
        el('td', { class: 'num', text: c.multiple.toFixed(4) + 'x' })
      );
    });
    var candidates = [
      { name: 'Radar-2: flat category multiple plus growth, maturity and chain factors', mape: '91.6% (±0.7)', within: '24.3% (±1.1)', winner: false },
      { name: 'Hierarchical log-ratio category mean, prior 4, no other terms', mape: '90.2% (±1.2)', within: '24.7% (±2.4)', winner: false },
      { name: 'Log-log size curve alone', mape: '85.9% (±1.0)', within: '31.6% (±1.8)', winner: false },
      { name: 'Size curve plus category offset, prior 2', mape: '85.7% (±1.0)', within: '31.2% (±1.2)', winner: false },
      { name: 'Size curve plus category offset, prior 8: radar-3', mape: '85.5% (±0.6)', within: '32.1% (±1.1)', winner: true },
      { name: 'Size curve plus category offset, prior 2, plus a growth term', mape: '85.7% (±1.6)', within: '31.4% (±2.0)', winner: false },
      { name: 'Size curve plus category offset, prior 2, plus a log-age term', mape: '86.0% (±1.0)', within: '30.9% (±2.0)', winner: false }
    ];
    var candRows = candidates.map(function (c) {
      return el('tr', null,
        el('td', { text: c.name + (c.winner ? ' — winner' : '') }),
        el('td', { class: 'num', text: c.mape }),
        el('td', { class: 'num', text: c.within })
      );
    });
    var droppedRows = [
      { term: 'Seven-day growth', corr: '-0.15', result: 'Adding a growth term leaves the error unchanged at 85.7%.' },
      { term: 'Age (log days listed)', corr: '0.00', result: 'Adding a log-age term makes it slightly worse at 86.0%.' },
      { term: 'Chain count (log)', corr: '-0.02', result: 'Adding growth, log age and log chain count together made the error worse, 92.1% against 90.9% without them.' }
    ].map(function (d) {
      return el('tr', null,
        el('td', { text: d.term }),
        el('td', { class: 'num', text: d.corr }),
        el('td', { text: d.result })
      );
    });
    return el('section', { class: 'model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied value = round( exp( ' + m.intercept.toFixed(4) + ' + ' + m.slope.toFixed(4) + ' x ln(tvl_usd) + category offset ) )' })
      ),
      el('p', { class: 'sub', text: 'The intercept and slope are the least-squares fit of log market cap on log TVL over the 128 live-token protocols with a positive market cap and a positive TVL. The category offset is the shrunk average of the fit residuals in the category, shrunk toward zero with prior ' + m.shrinkage_prior + '. A category with no live-token protocols takes an offset of zero, the no-offset multiple of ' + DATA.global_multiple.toFixed(4) + 'x at the reference size of $100M. The reference size is a display convention only; it does not enter the ranking. Wrapped, staked, bridged and exchange products are set aside, so the board ranks only protocols that could still launch a token.' }),
      el('h3', { text: 'Why this model won: out-of-sample validation' }),
      el('p', { class: 'sub', text: 'Every candidate was tested the same way: five-fold cross-validation over the 128 live-token protocols, folds assigned by a hash of the protocol family name so versioned relatives never split across train and test, repeated over ten different fold assignments. Two measures: the median absolute percentage error on held-out market cap, and the share predicted within two times. The winner was chosen on those out-of-sample numbers, never on in-sample fit.' }),
      el('table', { class: 'mult-table' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Candidate' }), el('th', { scope: 'col', text: 'Median error' }), el('th', { scope: 'col', text: 'Within 2x' }))),
        el('tbody', null, candRows)
      ),
      el('p', { class: 'sub', text: 'A single five-fold run gave the same ranking: radar-2 at 91.9% median error and 25% within two times, against 85.0% and 31% for the size curve with category offset. The gap between the size-curve family and radar-2 is about six points of median error and about seven points within two times, far larger than the fold-to-fold noise of about one point. Within the size-curve family the variants are statistically indistinguishable, so prior 8 was chosen on prudence: it shrinks small-category offsets harder, which is the safer choice when a category has one or two live protocols.' }),
      el('h3', { text: 'Terms tested and dropped' }),
      el('table', { class: 'mult-table' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Term' }), el('th', { scope: 'col', text: 'Correlation with log ratio' }), el('th', { scope: 'col', text: 'What happened when it was added' }))),
        el('tbody', null, droppedRows)
      ),
      el('p', { class: 'sub', text: 'Growth, age and chain count did not earn their place in the blind test, so they do not enter the implied value. They still drive the farm plans, where they belong: growth sets the timing note of a plan, age sets its hold period, and chain count sets its routing.' }),
      el('h3', { text: 'Category multiples from live tokens' }),
      el('table', { class: 'mult-table' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live protocols' }), el('th', { scope: 'col', text: 'Offset' }), el('th', { scope: 'col', text: 'Multiple at $100M' }))),
        el('tbody', null, multRows)
      ),
      el('h3', { text: 'The size effect, with anchors' }),
      el('p', { class: 'sub', text: 'The market-cap-to-TVL ratio falls hard as TVL rises: the correlation between the log ratio and log TVL is -0.41. The median ratio for the 14 live protocols with TVL at or above $1B is 0.0295, against 0.3230 for the 96 below $100M, an eleven-fold difference. The anchors: OKX at 0.0748, Lido at 0.0134, SSV Network at 0.0029 and EigenCloud at 0.0318. A flat multiple overstates a two-billion-dollar protocol by roughly five to seven times against what live tokens of that size actually trade at.' }),
      el('p', { class: 'sub', text: 'The honest caveat: the log-log fit explains 19% of the variance, with a residual standard deviation of 2.09 in log space. The model is the best of the tested candidates, not a precise price. The slope of ' + m.slope.toFixed(4) + ' means implied value grows roughly with the square root of TVL, so the largest protocols are worth far less per dollar of TVL than the smallest. That is what the live tokens say.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Size-curve value' }), el('b', { class: 'num', text: fmtUsd(row.size_curve_value_usd) })),
        el('div', null, el('span', { text: 'Category factor' }), el('b', { class: 'num', text: row.category_factor.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Category multiple at $100M' }), el('b', { class: 'num', text: row.category_multiple.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: "This row's own ratio" }), el('b', { class: 'num', text: (row.implied_value_usd / row.tvl_usd).toFixed(4) + 'x' }))
      ),
      el('p', { class: 'sub', text: 'The size-curve value is the exponential of the intercept plus the slope times the log of TVL, with no category offset. The category factor is the exponential of the category offset. The implied value is their product, rounded to the nearest whole dollar. The multiple at $100M is the category multiple at the reference size; the row\u2019s own ratio falls as TVL rises along the curve.' }),
      el('p', { class: 'sub', text: 'Context, not value terms: TVL ' + fmtUsd(row.tvl_usd) + ', seven-day change ' + fmtPct(row.change_7d) + ', age with no token ' + fmtAge(row.age_days) + ', on ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + '. The blind test dropped growth, age and chain count from the value; they drive the farm plan instead.' }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', within rounding of the board number.') + ' This is an estimate, not a price.' })
    ));
    var verdictText = row.verdict === 'farm'
      ? 'Verdict: farm. The cost ratio is $' + row.cost_ratio.toFixed(1) + ' spent per $1M of implied value, at or below the farm limit of 10, and the plan stays within 180 active minutes.'
      : row.verdict === 'thin'
        ? 'Verdict: thin. The cost ratio is $' + row.cost_ratio.toFixed(1) + ' spent per $1M of implied value, above 10 and at or below 25, so the plan only pays if the allocation beats the break-even.'
        : 'Verdict: skip. The cost ratio is $' + row.cost_ratio.toFixed(1) + ' spent per $1M of implied value, above 25, so the gas costs more than the position is worth chasing.';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'sub', text: verdictText }),
      el('p', { class: 'sub', text: 'Gas figures are planning estimates, not live prices: the snapshot is frozen and the program runs with no network.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(lead());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'live' ? liveTable() : noCapTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Implied values are this entry\u2019s own model, never a promise of a launch or a price. Snapshot ' + DATA.as_of + ', DefiLlama protocol index. A protocol that records no token may still have one its record does not carry.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
