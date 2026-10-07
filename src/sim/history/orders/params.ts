// orders: the tunables of the player's nudges (orders/system.ts). Each order raises a drive, a weight or a chance for the years of
// its kind (contract.ts describeOrderKinds: OrderKindInfo.years); the systems' own rules decide.

export const ORDERS = {
  // Explore: the people's towns build up the urge to explore exploreUrge times as fast, and an expedition's search weighs each
  // candidate cell by (d0 / (d + towardHalf * d0))^towardPow toward the target (d, d0: chords from the cell and from home to it).
  exploreUrge: 4,
  // (only the towns within nearShare of the people's nearest town's distance to the target, plus a cell; their needs are taken
  // as met to exploreSat at least, and the target is their frontier: they need nothing else unknown near them)
  nearShare: 1.25,
  nearHops: 2,
  senderPop: 300,
  exploreSat: 0.8,
  // (an ordered expedition's search takes a cell with exploreUnknown unknown cells on the way, not EXPLORE.minUnknown)
  exploreUnknown: 2,
  towardHalf: 0.25,
  towardPow: 3,
  // Settle: a founding site's score times min(settleMax, (d0 / (d + towardHalf * d0))^2) toward the target (1 at home's distance
  // is 0.64: sites the other way lose, sites that way gain); fulfilled by a new settlement within settleHops cells of the target.
  settleMax: 6,
  // (the towns near the target, as for Explore, send settlers with settleChance a year at least)
  settleChance: 0.06,
  // (and their groups' travel budget is settleReach times larger; they do not stop at a town on the way: frontier.ts passJoin)
  settleReach: 1.6,
  // (joining a town instead scores settleJoinMul of its usual)
  settleJoinMul: 0.02,
  settleHops: 4,
  // Crop: the species' adoption and domestication chances times cropMul at the people's settlements; a species that would not
  // raise the yield there (benefit <= 0) is still taken up, at cropMinBen of the chance.
  cropMul: 6,
  cropMinBen: 0.4,
  // Idea: the learning progress, adoption and conception chances of the idea times ideaMul.
  ideaMul: 8,
  // War: the pair's rivalry is read warRivalry higher and the declaration chance of the ordered side is warMul times higher.
  warRivalry: 0.5,
  warMul: 6,
  // Peace: a yearly chance of terms once the war is peaceAfter years old (beside the war's own end).
  peaceChance: 0.3,
  peaceAfter: 1,
  // Seat: the court moves with seatChance a year when the town has at least seatShare of the capital's people.
  seatChance: 0.12,
  seatShare: 0.25,
  // Faith: the faith's pull on the ruler (its share in the capital and realm) times faithPull, the conversion chance times faithMul.
  faithPull: 2.5,
  faithMul: 3,
  // Fortify: walls wanted at fortifyPop of the usual population (danger aside); the building chance times fortifyMul.
  fortifyPop: 0.4,
  fortifyMul: 2,
  // Quarantine: the memory of a great epidemic is not needed, wealth a head at quarWealth of the usual, chance quarChance a decade.
  quarWealth: 0.5,
  quarChance: 0.85,
} as const
