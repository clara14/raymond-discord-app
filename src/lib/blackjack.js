// ============================================================
// blackjack.js (lib) — Pure blackjack rules.
// No database, no Discord — just the game math, so it can be
// unit-tested in isolation.
// ============================================================

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

// Builds a fresh, ordered 52-card deck. Each card is { rank, suit }.
export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

// Fisher-Yates shuffle. rng is injectable so tests can be deterministic.
// Returns a new array; doesn't mutate the input.
export function shuffle(deck, rng = Math.random) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// Face value of a single rank. Aces count as 11 here; handValue downgrades
// them to 1 as needed.
export function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
  return Number(rank);
}

// Best total for a hand: sum the cards, then drop aces from 11 to 1 while
// the total is over 21. This gives the highest non-busting value available.
export function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

// A "natural" blackjack: exactly two cards totalling 21.
export function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

export function isBust(hand) {
  return handValue(hand) > 21;
}

// Dealer draws from the top of the deck until reaching 17 (stands on all 17).
// Returns the finished dealer hand and the remaining deck.
export function playDealer(dealerHand, deck) {
  const hand = [...dealerHand];
  const d = [...deck];
  while (handValue(hand) < 17) {
    hand.push(d.shift());
  }
  return { dealerHand: hand, deck: d };
}

// Decides the outcome from the player's perspective, given both final hands.
// Returns one of: 'blackjack' | 'win' | 'lose' | 'push'.
export function settle(playerHand, dealerHand) {
  const p = handValue(playerHand);
  const d = handValue(dealerHand);
  const playerBJ = isBlackjack(playerHand);
  const dealerBJ = isBlackjack(dealerHand);

  if (playerBJ && dealerBJ) return 'push';
  if (playerBJ) return 'blackjack';
  if (dealerBJ) return 'lose';
  if (p > 21) return 'lose';
  if (d > 21) return 'win';
  if (p > d) return 'win';
  if (p < d) return 'lose';
  return 'push';
}

// How many monies to CREDIT back for a result, given the bet was already
// debited at deal time. Net effect: lose -bet, push 0, win +bet,
// blackjack +1.5*bet (3:2). Math.floor keeps blackjack payouts integer.
export function payoutCredit(result, bet) {
  switch (result) {
    case 'blackjack':
      return bet + Math.floor(bet * 1.5); // stake back + 3:2 profit
    case 'win':
      return bet * 2; // stake back + equal winnings
    case 'push':
      return bet; // stake back only
    default:
      return 0; // lose — the debited bet is forfeited
  }
}
