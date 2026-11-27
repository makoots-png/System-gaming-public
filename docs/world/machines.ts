// machines.ts: every state machine of the world bible, as data. Each thing in the world that moves between states (a
// gate, a hunter's cap, a death, a contract, a GM-approved System message) is one machine here, and the prose files
// point at it and do not restate it.
// Print:  bun docs/world/machines.ts          (machines.md's text)
// Write:  bun docs/world/machines.ts --write  (writes docs/world/machines.md)
// The script fails when a machine is not well formed: see `faults`.

/** One step: in state `from`, when `on` happens (and `when` holds, if given), the thing moves to `to`. */
type Step = { from: string; on: string; when?: string; to: string };
type Machine = {
  /** The heading, and the name the prose files cite. */
  name: string;
  /** What the machine is the state of, and which files describe the rules behind it. */
  of: string;
  start: string;
  /** States with no step out: the thing's life is over there. */
  ends: readonly string[];
  /** Every state, in reading order, with what a person at the table can see in it. */
  states: Readonly<Record<string, string>>;
  steps: readonly Step[];
};

const MACHINES: readonly Machine[] = [
  {
    name: 'A world gate',
    of: 'One world gate, from opening to closing (`power.md` section 8, `economy.md` section 8).',
    start: 'Unfound',
    ends: ['Closed', 'Standing open'],
    states: {
      'Unfound': 'The gate is open and nobody has reported it. Its break day is counting down.',
      'Reported': 'A finder has told the Bureau. An assessor is on the way.',
      'Posted': 'The Bureau has read its rank and listed it on Doorwatch with its days left.',
      'Public': 'The Bureau holds the rights. A licensed party may pay the entry fee and enter.',
      'Rights held': 'A guild or company bought the rights at auction. Only its party may enter.',
      'Party inside': 'A party is in the gate. A red gate has sealed behind it.',
      'Cleared': 'The boss is dead. The gate is empty and stays open. Reclaimers may work.',
      'Second area open': 'A double gate: the door beyond the boss\'s room has been opened, and the second boss lives.',
      'Broken': 'Day 7 came. All monsters funnel out into the world and the gate closes behind them.',
      'Closed': 'The gate is gone.',
      'Standing open': 'A rare cleared gate that did not close on day 7. Nobody knows why. The Scar\'s B gate is one.',
    },
    steps: [
      { from: 'Unfound', on: 'someone reports it', to: 'Reported' },
      { from: 'Unfound', on: 'the break day comes', to: 'Broken' },
      { from: 'Reported', on: 'an assessor reads it', to: 'Posted' },
      { from: 'Reported', on: 'the break day comes', to: 'Broken' },
      { from: 'Posted', on: 'the Bureau keeps the rights', to: 'Public' },
      { from: 'Posted', on: 'the Bureau auctions the rights', to: 'Rights held' },
      { from: 'Posted', on: 'the break day comes', to: 'Broken' },
      { from: 'Public', on: 'a licensed party enters', to: 'Party inside' },
      { from: 'Public', on: 'the break day comes', to: 'Broken' },
      { from: 'Rights held', on: 'the holder\'s party enters', to: 'Party inside' },
      { from: 'Rights held', on: 'the break day comes', to: 'Broken' },
      { from: 'Party inside', on: 'the boss dies', to: 'Cleared' },
      { from: 'Party inside', on: 'the party leaves', when: 'the gate is not red, and the Bureau holds the rights', to: 'Public' },
      { from: 'Party inside', on: 'the party leaves', when: 'the gate is not red, and a holder has the rights', to: 'Rights held' },
      { from: 'Party inside', on: 'the whole party dies', when: 'the Bureau holds the rights', to: 'Public' },
      { from: 'Party inside', on: 'the whole party dies', when: 'a holder has the rights', to: 'Rights held' },
      { from: 'Party inside', on: 'the break day comes', to: 'Broken' },
      { from: 'Cleared', on: 'the party opens another door', when: 'the gate is a double gate', to: 'Second area open' },
      { from: 'Cleared', on: 'the break day comes', when: 'normal gate', to: 'Closed' },
      { from: 'Cleared', on: 'the break day comes', when: 'the gate is one of the few that stand', to: 'Standing open' },
      { from: 'Second area open', on: 'the second boss dies', to: 'Cleared' },
      { from: 'Second area open', on: 'the party leaves', when: 'the gate is not red, and the second boss still lives', to: 'Second area open' },
      { from: 'Second area open', on: 'the whole party dies', when: 'the second boss still lives', to: 'Second area open' },
      { from: 'Second area open', on: 'the break day comes', to: 'Broken' },
      { from: 'Broken', on: 'the last monster funnels out', to: 'Closed' },
    ],
  },
  {
    name: 'A break',
    of: 'A city\'s answer to one broken gate (`history.md` section 6).',
    start: 'Siren',
    ends: ['All clear', 'District lost'],
    states: {
      'Siren': 'The rising tone sounds. Residents\' windows show "Survive".',
      'Cordon up': 'Soldiers ring the area and move people out.',
      'Call-up': 'The Hunter Corps has ordered every licensed hunter in the district to the break.',
      'Contained': 'Nothing is getting past the cordon. Hunters are killing what is left.',
      'All clear': 'The siren stops. Insurers\' assessors walk in.',
      'District lost': 'The cordon fell back. The Bureau redraws the zone as Red.',
    },
    steps: [
      { from: 'Siren', on: 'the cordon arrives', to: 'Cordon up' },
      { from: 'Siren', on: 'the Corps calls hunters up directly', when: 'the break is in a Red zone with no rapid cordon', to: 'Call-up' },
      { from: 'Cordon up', on: 'the cordon holds', when: 'the monsters are E or D rank', to: 'Contained' },
      { from: 'Cordon up', on: 'the cordon fails', when: 'an E or D break overwhelms the infantry', to: 'Call-up' },
      { from: 'Cordon up', on: 'the Corps calls hunters up', when: 'the monsters are C rank or higher', to: 'Call-up' },
      { from: 'Call-up', on: 'enough hunters arrive', to: 'Contained' },
      { from: 'Call-up', on: 'too few hunters arrive', to: 'District lost' },
      { from: 'Contained', on: 'the last monster dies', to: 'All clear' },
    ],
  },
  {
    name: 'A personal gate',
    of: 'One personal gate, which a gate key or the GM opens for one hunter (`power.md` section 4, `items.md`).',
    start: 'Open',
    ends: ['Gone'],
    states: {
      'Open': 'The gate stands beside the hunter for a day. Nobody else can enter it.',
      'Hunter inside': 'The hunter is fighting one or two monsters alone.',
      'Gone': 'The gate has closed.',
    },
    steps: [
      { from: 'Open', on: 'the hunter enters', to: 'Hunter inside' },
      { from: 'Open', on: 'a day passes', to: 'Gone' },
      { from: 'Hunter inside', on: 'the monsters die', to: 'Gone' },
      { from: 'Hunter inside', on: 'the hunter gets out, beaten', to: 'Gone' },
      { from: 'Hunter inside', on: 'the hunter dies', to: 'Gone' },
    ],
  },
  {
    name: 'A person and the System',
    of: 'What one person is to the System, from birth (`power.md` sections 1 to 5, `story.md` section 2).',
    start: 'Resident',
    ends: ['Dead of the fever', 'Uncapped'],
    states: {
      'Resident': 'The window reads "Resident, level 0" and opens the Resident Store (everyday goods and essentials, active since the first hunter awakened).',
      'In the fever': 'Three days above 40 degrees, with blue veins at the wrists.',
      'Dead of the fever': 'About one person in sixty does not come out of it.',
      'Hunter, below the cap': 'The window shows a job, a rank and a level. XP raises the level.',
      'Hunter, at the cap': 'The XP bar has stopped. The daily quest still comes.',
      'Offered a trial': 'A personal gate of an unusual colour is open for the hunter.',
      'Uncapped': 'The window reads "Cap: none". The level rises through every rank.',
    },
    steps: [
      { from: 'Resident', on: 'the fever starts', to: 'In the fever' },
      { from: 'In the fever', on: 'the fever breaks', to: 'Hunter, below the cap' },
      { from: 'In the fever', on: 'the fever kills', to: 'Dead of the fever' },
      { from: 'Hunter, below the cap', on: 'the level reaches the rank\'s top', to: 'Hunter, at the cap' },
      { from: 'Hunter, below the cap', on: 'the hunter clears an off-books sponsor trial', when: 'brief second fever follows (Mission 1: The Empty Seat)', to: 'Uncapped' },
      { from: 'Hunter, at the cap', on: 'the System opens a trial gate, which the GM decides', to: 'Offered a trial' },
      { from: 'Offered a trial', on: 'the hunter passes an open trial', when: 'brief second fever follows', to: 'Uncapped' },
      { from: 'Offered a trial', on: 'the hunter passes a step trial', when: 'cap rises by one rank with a second fever (recorded re-awakening)', to: 'Hunter, below the cap' },
      { from: 'Offered a trial', on: 'the hunter fails the trial', to: 'Hunter, at the cap' },
      { from: 'Offered a trial', on: 'a day passes and the hunter has not entered', to: 'Hunter, at the cap' },
      { from: 'Hunter, at the cap', on: 'a raising takes a level', when: 'the table uses that rule', to: 'Hunter, below the cap' },
    ],
  },
  {
    name: 'Registration',
    of: 'A hunter\'s standing with the Bureau (`careers.md` section 1).',
    start: 'Not yet due',
    ends: [],
    states: {
      'Not yet due': 'The person has not awakened, or is still in the fever.',
      'Inside the 72 hours': 'The fever has broken. The Bureau\'s card gives the deadline.',
      'Registered': 'The rank is in the Register and public. The hunter holds a licence.',
      'Unregistered': 'The 72 hours have passed. The hunter has no licence and owes a fine.',
      'Under a new reading': 'The Bureau or a guild has ordered the hunter read again.',
    },
    steps: [
      { from: 'Not yet due', on: 'the fever breaks', to: 'Inside the 72 hours' },
      { from: 'Inside the 72 hours', on: 'the hunter is read at a Bureau hall', to: 'Registered' },
      { from: 'Inside the 72 hours', on: '72 hours pass', to: 'Unregistered' },
      { from: 'Unregistered', on: 'the hunter is read and pays the fine', to: 'Registered' },
      { from: 'Registered', on: 'a second fever is reported, a court orders it, or a guild invokes its reading clause', to: 'Under a new reading' },
      { from: 'Under a new reading', on: 'the assessor files the result', to: 'Registered' },
    ],
  },
  {
    name: 'Revive standing',
    of: 'the owner\'s revive ladder for one hunter (`economy.md` section 13, `power.md` section 8, `story.md` section 3).',
    start: 'Free revive left',
    ends: ['Crystal or GM only'],
    states: {
      'Free revive left': 'The hunter has never died. Their first revive within the hour is free of gold cost.',
      'Debt revive left': 'The free revive is spent. One revive on debt (ten Clears) remains.',
      'Crystal or GM only': 'Both System revives are spent. Only a Resurrection Crystal bought before death, or a GM grant, can raise the hunter. Gold held after death does not help.',
    },
    steps: [
      { from: 'Free revive left', on: 'the hunter takes their free revive', to: 'Debt revive left' },
      { from: 'Debt revive left', on: 'the hunter takes their one revive on debt', to: 'Crystal or GM only' },
    ],
  },
  {
    name: 'A death',
    of: 'One hunter\'s life, death and raising under the revive ladder (`economy.md` section 13, `power.md` section 8, `story.md` section 3).',
    start: 'Alive',
    ends: ['Dead for good'],
    states: {
      'Alive': 'The hunter is alive.',
      'Dead, within the hour': 'The hunter has died. Only the revive ladder, a crystal bought before death, or a GM grant can raise them within an hour. Gold held after death does not help.',
      'Dead for good': 'The hour has passed. The will takes effect and the death benefit falls due.',
    },
    steps: [
      { from: 'Alive', on: 'the hunter dies', to: 'Dead, within the hour' },
      { from: 'Dead, within the hour', on: 'the System raises the hunter for free', when: 'Revive standing is Free revive left', to: 'Alive' },
      { from: 'Dead, within the hour', on: 'the hunter takes their one revive on debt', when: 'Revive standing is Debt revive left', to: 'Alive' },
      { from: 'Dead, within the hour', on: 'a crystal of the hunter\'s rank or higher is used', when: 'bought before the death', to: 'Alive' },
      { from: 'Dead, within the hour', on: 'the GM grants a revive', to: 'Alive' },
      { from: 'Dead, within the hour', on: 'an hour passes', to: 'Dead for good' },
    ],
  },
  {
    name: 'A crystal debt',
    of: 'What a hunter owes for their single debt revive or for a pre-bought crystal bought on lender credit (`careers.md` section 4, `economy.md` section 13).',
    start: 'No debt',
    ends: [],
    states: {
      'No debt': 'The hunter owes nothing for a revive or a crystal.',
      'In debt': 'The hunter owes ten Clears (for their one debt revive, or a lender\'s pre-bought crystal), with monthly interest if refinanced by a guild or lender.',
    },
    steps: [
      { from: 'No debt', on: 'the hunter takes their one revive on debt, or finances a pre-bought crystal', to: 'In debt' },
      { from: 'In debt', on: 'the hunter finances another pre-bought crystal before entering a gate', to: 'In debt' },
      { from: 'In debt', on: 'the hunter pays it off, or the Corps pays it for five years\' service', to: 'No debt' },
    ],
  },
  {
    name: 'A guild contract',
    of: 'One hunter\'s contract with one guild (`careers.md` sections 3, 4 and 7).',
    start: 'Offered',
    ends: ['Declined', 'Ended'],
    states: {
      'Offered': 'A scout has put the paper in front of the hunter.',
      'Declined': 'The hunter did not sign.',
      'In force': 'The guild pays the retainer and takes the house share. The hunter is seated at the guild\'s choice.',
      'Injured': 'The hunter is unfit for gates. The guild pays the retainer for up to three months.',
      'Retainer stopped': 'The hunter declined a seat, or stayed unfit past three months of injury pay. The guild pays no retainer until the hunter returns to duty.',
      'On loan': 'The hunter is working another guild\'s gate. The lending guild keeps the fee.',
      'Ended': 'The term ran out with no renewal, another guild bought the contract, the hunter walked, or the hunter died for good.',
    },
    steps: [
      { from: 'Offered', on: 'the hunter signs', to: 'In force' },
      { from: 'Offered', on: 'the hunter refuses', to: 'Declined' },
      { from: 'In force', on: 'the hunter is injured', to: 'Injured' },
      { from: 'Injured', on: 'the hunter recovers within three months', to: 'In force' },
      { from: 'Injured', on: 'three months pass while still unfit', to: 'Retainer stopped' },
      { from: 'Injured', on: 'the hunter dies for good', to: 'Ended' },
      { from: 'In force', on: 'the hunter declines a seat', to: 'Retainer stopped' },
      { from: 'Retainer stopped', on: 'the next month starts and the hunter returns to duty', to: 'In force' },
      { from: 'Retainer stopped', on: 'the hunter dies for good', to: 'Ended' },
      { from: 'In force', on: 'the guild lends the hunter', to: 'On loan' },
      { from: 'On loan', on: 'the loan ends', to: 'In force' },
      { from: 'On loan', on: 'the hunter dies for good', to: 'Ended' },
      { from: 'In force', on: 'the term ends and both renew', to: 'In force' },
      { from: 'In force', on: 'the term ends with no renewal', to: 'Ended' },
      { from: 'In force', on: 'another guild pays the buyout and the hunter agrees', to: 'Ended' },
      { from: 'In force', on: 'the hunter walks and owes the remaining retainers', to: 'Ended' },
      { from: 'In force', on: 'the hunter dies for good', to: 'Ended' },
    ],
  },
  {
    name: 'A guild gear lien',
    of: 'Gear a hunter buys on guild credit (`careers.md` section 4 trap 5, `economy.md` section 7).',
    start: 'On credit',
    ends: ['Owned by hunter', 'Returned on exit'],
    states: {
      'On credit': 'The hunter wears the gear. The guild owns it until the full Shop price is paid.',
      'Owned by hunter': 'The hunter paid the full Shop price and owns the gear outright.',
      'Returned on exit': 'The hunter left the guild, returned the gear, and still owes any unpaid balance.',
    },
    steps: [
      { from: 'On credit', on: 'the hunter pays the full Shop price', to: 'Owned by hunter' },
      { from: 'On credit', on: 'the contract ends before payment is complete', to: 'Returned on exit' },
    ],
  },
  {
    name: 'A party bond',
    of: 'A deposit an unsigned party lodges with the Bureau for queue priority (`careers.md` section 6).',
    start: 'Posted',
    ends: ['Returned', 'Forfeited'],
    states: {
      'Posted': 'Two Clears per hunter sit with the Bureau. The party is seated ahead of unbonded parties.',
      'Returned': 'The gate was cleared. The Bureau returns the whole deposit.',
      'Forfeited': 'The party left the gate uncleared or wiped. The Bureau keeps the deposit.',
    },
    steps: [
      { from: 'Posted', on: 'the party clears the gate', to: 'Returned' },
      { from: 'Posted', on: 'the party leaves uncleared or wipes', to: 'Forfeited' },
    ],
  },
  {
    name: 'Shadow extraction',
    of: 'One corpse a Necromancer tries to extract (`power.md` section 7, `factions.md` Gravewardens).',
    start: 'Corpse fresh',
    ends: ['Registered', 'Lost'],
    states: {
      'Corpse fresh': 'The Necromancer has up to three extraction attempts before the mana fades.',
      'Extracted, unregistered': 'The shadow serves the Necromancer. The law requires logging it with the Gravewardens.',
      'Registered': 'The shadow is recorded in the Gravewardens\' register.',
      'Lost': 'Three attempts failed, or the corpse decayed without extraction.',
    },
    steps: [
      { from: 'Corpse fresh', on: 'an attempt fails', when: 'fewer than three attempts used', to: 'Corpse fresh' },
      { from: 'Corpse fresh', on: 'an attempt succeeds', to: 'Extracted, unregistered' },
      { from: 'Corpse fresh', on: 'the third attempt fails or the mana fades', to: 'Lost' },
      { from: 'Extracted, unregistered', on: 'the Gravewardens record the shadow', to: 'Registered' },
    ],
  },
  {
    name: 'A piece of gear\'s grade',
    of: 'One weapon, armor piece or accessory, as enhancement stones are used on it (`items.md` section 5).',
    start: 'Minus',
    ends: ['Plus'],
    states: {
      'Minus': 'The item is weaker than its tier\'s middle and costs two thirds of a Clear.',
      'Middle': 'The item is its tier\'s middle and costs one Clear.',
      'Plus': 'The item is its tier\'s best grade and costs one and a half Clears. No stone raises it further.',
    },
    steps: [
      { from: 'Minus', on: 'a stone of the item\'s tier works', to: 'Middle' },
      { from: 'Minus', on: 'a stone fails and is lost', to: 'Minus' },
      { from: 'Middle', on: 'a stone of the item\'s tier works', to: 'Plus' },
      { from: 'Middle', on: 'a stone fails and is lost', to: 'Middle' },
    ],
  },
  {
    name: 'A profession',
    of: 'One crafter\'s tier in their profession (`items.md` section 4). A hunter\'s cap does not stop it.',
    start: 'None',
    ends: ['Grandmaster'],
    states: {
      'None': 'The person has learned no profession.',
      'Apprentice': 'Makes common items.', 'Journeyman': 'Makes uncommon items.',
      'Adept': 'Makes rare items. The crafter has picked a branch.', 'Expert': 'Makes epic items.',
      'Master': 'Makes legendary items.', 'Grandmaster': 'Makes mythic items.',
    },
    steps: [
      { from: 'None', on: 'the person takes up a profession', to: 'Apprentice' },
      { from: 'Apprentice', on: 'enough common items made', to: 'Journeyman' },
      { from: 'Journeyman', on: 'enough uncommon items made, and a branch picked', to: 'Adept' },
      { from: 'Adept', on: 'enough rare items made', to: 'Expert' },
      { from: 'Expert', on: 'enough epic items made', to: 'Master' },
      { from: 'Master', on: 'a masterwork made from a named part', to: 'Grandmaster' },
    ],
  },
  {
    name: 'A crystal cover policy',
    of: 'One hunter\'s policy for one year (`economy.md` section 12, `careers.md` section 6).',
    start: 'In force',
    ends: ['Lapsed'],
    states: {
      'In force': 'The premium is paid. One pre-bought crystal used on the hunter this year will be repaid.',
      'Claim made': 'A pre-bought crystal was used on the hunter. The insurer\'s assessor is checking where the death happened.',
      'Used for the year': 'The insurer has repaid one crystal. It repays no second one before renewal.',
      'Lapsed': 'The premium was not paid.',
    },
    steps: [
      { from: 'In force', on: 'a pre-bought crystal raises the hunter', to: 'Claim made' },
      { from: 'Claim made', on: 'the insurer pays', when: 'the death was in a licensed world gate with a party', to: 'Used for the year' },
      { from: 'Claim made', on: 'the insurer refuses', when: 'the death was in a personal gate, a gate entered alone or an unlicensed gate, or another hunter caused it', to: 'In force' },
      { from: 'Used for the year', on: 'the year ends and the premium is paid', to: 'In force' },
      { from: 'In force', on: 'the year ends and the premium is paid', to: 'In force' },
      { from: 'In force', on: 'the year ends and the premium is not paid', to: 'Lapsed' },
      { from: 'Used for the year', on: 'the year ends and the premium is not paid', to: 'Lapsed' },
    ],
  },
  {
    name: 'The daily quest',
    of: 'One hunter\'s daily quest, day after day (`power.md` section 3). Finishing it never heals HP, restores mana, or clears fatigue.',
    start: 'Issued',
    ends: [],
    states: {
      'Issued': 'Today\'s quest is in the window and not finished.',
      'Done': 'The hunter finished it. A hunter below the cap gained XP. No HP, mana, or fatigue was restored.',
      'Penalized': 'The hunter missed yesterday\'s quest. Every check takes a penalty until the Penalty Zone quest is finished.',
    },
    steps: [
      { from: 'Issued', on: 'the hunter finishes it', to: 'Done' },
      { from: 'Issued', on: 'the day ends', to: 'Penalized' },
      { from: 'Done', on: 'the day ends', to: 'Issued' },
      { from: 'Penalized', on: 'the hunter finishes the Penalty Zone quest', to: 'Issued' },
      { from: 'Penalized', on: 'the day ends', to: 'Penalized' },
    ],
  },
  {
    name: 'A System message or reward',
    of: 'Every System window line, viewer tip, scenario, or reward before players see it (the owner\'s ruling; `README.md`, `story.md` sections 6 and 7).',
    start: 'Drafted',
    ends: ['Delivered', 'Withheld'],
    states: {
      'Drafted': 'A System notice, scenario, reward, or Patron message has been proposed.',
      'Under GM review': 'The GM reads the exact text and reward amounts and may edit either.',
      'Delivered': 'The GM approved the message or reward. Players see it in their windows.',
      'Withheld': 'The GM rejected or held it. Players see nothing.',
    },
    steps: [
      { from: 'Drafted', on: 'queued for the GM', to: 'Under GM review' },
      { from: 'Under GM review', on: 'the GM edits wording or reward', to: 'Under GM review' },
      { from: 'Under GM review', on: 'the GM approves it', to: 'Delivered' },
      { from: 'Under GM review', on: 'the GM rejects or holds it', to: 'Withheld' },
    ],
  },
  {
    name: 'Sponsor patronage',
    of: 'One uncapped hunter\'s relationship with viewers and a Patron (`story.md` Act 3 and section 7). For the GM only.',
    start: 'Unwatched',
    ends: [],
    states: {
      'Unwatched': 'The hunter is capped. No viewer count appears.',
      'Off-books grant': 'The hunter is uncapped from an unscheduled sponsor trial (Mission 1). A blank line sits below Cap: none, and no public Viewers count appears yet.',
      'Watched': 'The window shows a Viewers count. Named viewers may send tips through GM review.',
      'Sponsored': 'One Patron has adopted the hunter and sends regular gold and gear.',
      'Private quest active': 'The Patron has offered a private quest (GM-approved) with a Shop reward.',
      'Dropped': 'The Patron cut the hunter off after a refusal or boring play. Other viewers still watch.',
    },
    steps: [
      { from: 'Unwatched', on: 'the hunter passes a standard Host open trial', to: 'Watched' },
      { from: 'Unwatched', on: 'the hunter clears an off-books sponsor trial', to: 'Off-books grant' },
      { from: 'Off-books grant', on: 'the hunter passes the Act 2 Network Audit', to: 'Watched' },
      { from: 'Watched', on: 'a Patron adopts the hunter', to: 'Sponsored' },
      { from: 'Sponsored', on: 'the Patron offers a private quest', when: 'approved by the GM', to: 'Private quest active' },
      { from: 'Private quest active', on: 'the hunter completes it', to: 'Sponsored' },
      { from: 'Private quest active', on: 'the hunter refuses it', when: 'the Patron stays amused', to: 'Sponsored' },
      { from: 'Private quest active', on: 'the hunter refuses it', when: 'the Patron loses patience', to: 'Dropped' },
      { from: 'Dropped', on: 'another Patron steps in', to: 'Sponsored' },
    ],
  },
  {
    name: 'A keepsake',
    of: 'One memory or bond the System takes as collateral at a raising (`story.md` section 3 and Act 4). For the GM only.',
    start: 'Held by hunter',
    ends: ['Restored', 'Sold to a viewer'],
    states: {
      'Held by hunter': 'The hunter still has the memory or relationship.',
      'Taken as collateral': 'The hunter was raised. The window showed "Collateral taken".',
      'Listed at terminal': 'The memory sits on the Act 4 Keepsakes terminal for sale.',
      'Restored': 'The hunter paid the terminal\'s price in levels and recovered the memory.',
      'Sold to a viewer': 'A viewer bought the memory as a season keepsake. It cannot be bought back.',
    },
    steps: [
      { from: 'Held by hunter', on: 'the hunter is raised', to: 'Taken as collateral' },
      { from: 'Taken as collateral', on: 'the Hosts catalog it for the season store', to: 'Listed at terminal' },
      { from: 'Listed at terminal', on: 'the hunter pays the level cost at the terminal', to: 'Restored' },
      { from: 'Listed at terminal', on: 'a viewer buys it first', to: 'Sold to a viewer' },
    ],
  },
  {
    name: 'A scenario',
    of: 'One city-wide quest of the season\'s second half (`story.md` act 3). For the GM only.',
    start: 'Issued',
    ends: ['Met', 'Penalty applied'],
    states: {
      'Issued': 'Every window in the city shows the GM-approved task, the timer and the penalty.',
      'Met': 'The city did what was asked. Viewers pay out.',
      'Penalty applied': 'The timer ran out. The System did what it said it would.',
    },
    steps: [
      { from: 'Issued', on: 'the task is done before the timer ends', to: 'Met' },
      { from: 'Issued', on: 'the timer ends', to: 'Penalty applied' },
    ],
  },
  {
    name: 'The season',
    of: 'Earth\'s season of the game, which is the campaign (`story.md` section 4). For the GM only.',
    start: 'First half',
    ends: ['The seat is empty', 'The party holds the seat'],
    states: {
      'First half': 'Twenty years of gates. The System has stated no goal. Acts 1 and 2.',
      'Second half': 'An uncapped party crosses the broadcast\'s cast and viewer threshold, so the System issues scenarios and viewers sponsor hunters. Acts 3 and 4.',
      'Finale': 'An SSS-rank gate opens, sits seven days, and releases something higher than mythic (the first season\'s winners) before closing behind them. Act 5.',
      'Season complete': 'Earth won. Every uncapped hunter is offered the Finale contract.',
      'Earth is lost': 'The Finale won. Earth\'s people become the next world\'s monsters.',
      'Control room': 'The party is among the Hosts. Act 6.',
      'The seat is empty': 'The Hosts are dead and nobody runs the game. Gates still open.',
      'The party holds the seat': 'The party runs the game.',
    },
    steps: [
      { from: 'First half', on: 'the party passes the Act 2 Network Audit and hits the viewer threshold', to: 'Second half' },
      { from: 'Second half', on: 'the Tide\'s countdown ends', to: 'Finale' },
      { from: 'Finale', on: 'Earth\'s hunters win', to: 'Season complete' },
      { from: 'Finale', on: 'Earth\'s hunters lose', to: 'Earth is lost' },
      { from: 'Earth is lost', on: 'the party survives and finds the last gate', to: 'Control room' },
      { from: 'Season complete', on: 'the party enters the last gate', to: 'Control room' },
      { from: 'Control room', on: 'the party kills the Hosts and leaves', to: 'The seat is empty' },
      { from: 'Control room', on: 'the party kills the Hosts and stays', to: 'The party holds the seat' },
    ],
  },
];

/** What is wrong with a machine: a state used and not declared, one no step reaches, a state that is not an end and has no step out, an end with a step out, or two steps a reader cannot tell apart. */
function faults(m: Machine): string[] {
  const out: string[] = [], declared = new Set(Object.keys(m.states));
  const need = (s: string, where: string): void => { if (!declared.has(s)) out.push(`${where} names "${s}", which is not a state`); };
  need(m.start, 'start');
  for (const e of m.ends) need(e, 'ends');
  for (const s of m.steps) { need(s.from, 'a step'); need(s.to, 'a step'); }
  const reached = new Set([m.start]);
  for (let grew = true; grew;) { grew = false; for (const s of m.steps) if (reached.has(s.from) && !reached.has(s.to)) { reached.add(s.to); grew = true; } }
  for (const s of declared) if (!reached.has(s)) out.push(`no step reaches "${s}"`);
  for (const s of declared) {
    const leaves = m.steps.some(x => x.from === s && x.to !== s), isEnd = m.ends.includes(s);
    if (!isEnd && !leaves && m.ends.length) out.push(`"${s}" is not an end and no step leaves it`);
    if (isEnd && m.steps.some(x => x.from === s)) out.push(`"${s}" is an end and a step leaves it`);
  }
  const seen = new Set<string>();
  for (const s of m.steps) { const k = `${s.from}|${s.on}|${s.when ?? ''}`; if (seen.has(k)) out.push(`two steps from "${s.from}" on "${s.on}" with the same condition`); seen.add(k); }
  for (const s of m.steps) {
    if (!s.when && m.steps.some(x => x !== s && x.from === s.from && x.on === s.on)) {
      out.push(`step from "${s.from}" on "${s.on}" has no condition while another step shares that event`);
    }
  }
  return [...new Set(out)];
}

function chart(m: Machine): string {
  const ids = new Map(Object.keys(m.states).map((s, i) => [s, `s${i + 1}`]));
  const id = (s: string): string => ids.get(s) ?? s;
  const lines = ['```mermaid', 'stateDiagram-v2', ...Object.keys(m.states).map(s => `  state "${s}" as ${id(s)}`), `  [*] --> ${id(m.start)}`,
    ...m.steps.map(s => `  ${id(s.from)} --> ${id(s.to)} : ${s.on}${s.when ? ` [${s.when}]` : ''}`), ...m.ends.map(e => `  ${id(e)} --> [*]`), '```'];
  return lines.join('\n');
}
const table = (head: string[], rows: string[][]): string => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

const text = [
  '# State machines of the world',
  '',
  'Generated by `bun docs/world/machines.ts --write`. Do not edit this file by hand. Edit `machines.ts`.',
  '',
  'Each thing in the world that moves between states has one machine here. The other files give the reasons and the',
  'prices and point here for the states. A box is what a person at the table can see. An arrow is what makes it change.',
  'Words in brackets on an arrow are a condition. The script refuses to write this file if a machine names a state it',
  'does not declare, has a state nothing reaches, has a state with no way out that is not an end, or has two arrows a',
  'reader cannot tell apart.',
  '',
  table(['Machine', 'What it is the state of'], MACHINES.map(m => [m.name, m.of])),
  ...MACHINES.flatMap(m => ['', `## ${m.name}`, '', m.of, '', chart(m), '',
    table(['State', 'What a person sees'], Object.entries(m.states).map(([s, what]) => [m.ends.includes(s) ? `${s} (end)` : s === m.start ? `${s} (start)` : s, what])), '',
    table(['From', 'When this happens', 'Only if', 'To'], m.steps.map(s => [s.from, s.on, s.when ?? '', s.to]))]),
  '',
].join('\n');

const bad = MACHINES.flatMap(m => faults(m).map(f => `${m.name}: ${f}`));
for (const b of bad) console.error(`MACHINE FAULT: ${b}`);
if (bad.length) process.exit(1);
if (process.argv.includes('--write')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(new URL('machines.md', import.meta.url).pathname, text);
} else console.log(text);
