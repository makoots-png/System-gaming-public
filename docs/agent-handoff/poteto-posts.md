# Field notes from @poteto

Optional reading for the improvement run. These are posts by Lauren Tan ([@poteto](https://x.com/poteto)), the author of the pstack skills already in `.claude/skills/`. They were scraped from X on 12 Nov 2026. Dates below are in America/Buenos_Aires.

The posts are quoted verbatim (long posts use the full `note_tweet` text; X articles use `article.plain_text`). Skills and `START-HERE.md` win if anything here disagrees with them. Several posts restate ideas already encoded as skills (`principle-prove-it-works`, `/correct`, `/no-comments`, `/create-verification-skill`, `/create-formal-verification-skill`, `/statechart`, `/architect`, `/in-your-own-words`); those are included only when they add a field note that is not already in the skill text.

232 unique original posts were scanned (plain retweets excluded), from 31 Aug 2026 through 12 Nov 2026: recency paging of recent weeks, plus searches for pstack, verification, architecture, comments, state machines, and the pstack guide articles, with thread continuations fetched by `conversation_id`. Skill-release announcements, install tutorials, jokes, personal posts, and marketing were dropped.

## Make the easy thing the right thing

**[16 Oct 2026, 1:32 PM (America/Buenos_Aires)](https://x.com/poteto/status/2111133080526495985)**

> how do you trust your agents' work more? copy this post/link and give it to your @bot or agent!
>
> 1. codebase improvements: this is just good software engineering - better architecture, stronger types and invariants, clear boundaries. agents love to copy what exists and take the shortest path, so make the easy thing the right thing. categorically eliminate problems through code and you won't need to think about it again.
> 2. static analysis: lint rules, tests, CI, verification (eg TLA+). very token efficient ways to catch issues ahead of time.
> 3. prose: comments, rules, AGENTS.md, skills - anything that can't be enforced and requires agent judgment. use it minimally, but do use /create-verification-skill.
> 4. human review: the hardest to scale. at the rate agents land code, it's pretty much impossible to thoroughly review every PR, so spend that effort on the highest leverage point, designing an environment where agents do the right thing by default.
>
> this forms an inverse pyramid: you want most of your effort at the top, least at the bottom. codebase improvements are deterministic, making it more token efficient, and lets you sleep more soundly at night.
>
> install https://t.co/u9xIlN3eN0 and create a new Project:
> 1. look through my slack/chat messages and code review comments where i've given feedback on PRs, code, architecture
> 2. use /recall on my past transcripts to learn how i steer agents
> 3. /poteto-mode use /correct and /architect on past commits to find the most common pitfalls agents fall into, then propose a plan to rearchitect the code i own so it's more agent friendly. answer open questions with prototyping rather than defer to me, and back the plan with real data. 
> 4. before you begin, use /sharpen + /in-your-own-words and confirm this prompt with me

*Applies here because this is the design goal of phase 3: typed core modules, registries, and CI checks should make the easy addition the right one, and AGENTS.md should stay thin compared to those constraints.*

**[30 Oct 2026, 12:34 PM (America/Buenos_Aires)](https://x.com/poteto/status/2116191971714953262)**

> we will need to rebuild and rewrite much of software to adapt to a new, faster pace. 
>
> code used to arrive one drop at a time. soon, if not already, code will be written as if it were a continuous stream, like a violent river twisting and turning as it pleases. 
>
> this is not a new thing: big tech cos have had to deal with this with the enormous scale of their engineering teams. but now ai has brought an incredibly elastic and capable workforce wielded by every engineer. this is your problem now, and the only way to adapt is to evolve your systems so agents - even and especially the ones with little context about the right way of doing things - can thrive. make the easy thing the right thing. 
>
> your codebase is becoming organic architecture. agent contributions grow around the constraints and guardrails you’ve designed. good software engineering matters even more now! and no, the continuous stream of code is not something you have to watch helplessly. be more ambitious and design systems, frameworks, and languages to control the chaos. 
>
> the time for mourning coding is long over

*Applies here because phase 3 is exactly this kind of rewrite: implicit machines become explicit unions and reducers so later additions (and later agents) grow around the guardrails.*

**[27 Oct 2026, 2:26 PM (America/Buenos_Aires)](https://x.com/poteto/status/2115133011352240581)**

> the Grok Bot team ships quality at an incredible pace! we've invested in making our code friendly for agents, by making the easy thing the right thing. 
>
> engineers, designers, and PMs all contribute multiple hundreds of PRs a day: fixing bugs, polishing the user experience, and making our apps faster and more reliable. it isn't perfect of course and we do make mistakes, but we aim to learn from each occurrence and improve our workflows so our bots don't make the same mistake twice.
>
> i personally think that Grok Bot is the best example today in the industry of where all those tokens are going: quality and velocity, without compromise. something i think people forget in the discussion around token usage is that software development is an iceberg - new features are only a small fraction of the work in maintaining high quality software. 
>
> and we will keep accelerating and improving!

*Applies here because when a helper or lead introduces a bug, prefer a type, lint, or test that prevents the next one, rather than another prose reminder.*

**[3 Oct 2026, 9:31 PM (America/Buenos_Aires)](https://x.com/poteto/status/2106542593656111276)**

> it's easy to fall into the trap of micromanaging your agents instead of correcting the environment that shapes its behavior. 
>
> pstack 0.15.9 now ships a new /correct skill: if you keep correcting agents for the same mistakes, it finds the pattern and fixes it with architecture, types, and checks.
>
> i like to imagine that commits rapidly flowing into the codebase are like a bonsai tree rapidly growing in whatever direction it pleases. what you want to do is not to give in to the chaos, but tame it intentionally with the right constraints
>
> 0.15.9 also has improvements to:
> • /architect: now includes instructions on designing agent friendly architecture
> • a new /benchmark-checklist skill based on @brendangregg's benchmarking checklist
>
> here's a prompt you can give to grok bot to start architecting a better codebase with pstack: 
>
> /poteto-mode create a new Project agent to refactor and rearchitect my repo so that our architecture is more agent friendly. it should use both the /correct and /architect skill to look through past commits and find the most common pitfalls that agents fall into, whether its with code quality, performance, or bugs. if relevant you can also use the /recall skill to find past conversations for context. it should make a high level plan for me to review. it should also answer its own open questions by prototyping rather than defer to me. come back to me with a plan backed by real data. once i approve the plan, use either the stack or full autopilot playbook (ask me which i want) to execute

*Applies here because the architecture pass should correct the repo, not pile more instructions onto helpers. Answering open questions by prototyping also matches the 'prove it works' rule.*

Overlap: this is the announcement of `/correct` and an `/architect` update, both already in `.claude/skills/`. The useful field note is the environment-vs-micromanagement framing, and the instruction to prototype instead of deferring questions.

**[26 Oct 2026, 4:54 AM (America/Buenos_Aires)](https://x.com/poteto/status/2114626630429913383)**

> so many gems and great tips in this talk from @yminsky about how to improve your codebase for agents
>
> • agents thrive on feedback, and types are one of the best kinds 
> • make illegal states unrepresentable with types, and it enforces global rules across your codebase
> • property based tests, fuzzing, and even full-system deterministic simulation testing
> • expect tests: just print stuff out and capture it in the test. makes behavior legible. it's very similar to how compilers have fixture tests, it reduces the review surface area
> • formal methods used to be very expensive: seL4 is about 8,700 lines of C and took around 25 person-years, with 23 lines of proof for every line of C code, but agents change the roi 
>
> https://t.co/0zDb5euxhr

*Applies here because M3–M7 are making illegal states unrepresentable with explicit unions and pure reducers; M6 already plans a model check of the link and push machines; prefer tests that assert observable behaviour (and fixture-style expectations where that is clearer) over tests that lock internals.*

## Move prose into types, lints, and APIs

**[14 Oct 2026, 7:30 PM (America/Buenos_Aires)](https://x.com/poteto/status/2110498629307990461)**

> i like the flexibility of skills since you can omit or invoke on demand! but in general i'm a big advocate of moving prose into deterministic code: lint rules, strong types, good API design are superior to comments, agents.md, rules, skills
>
> for pstack efficiency, definitely run /setup-pstack and choose your budget level, and when you invoke /poteto-mode you can also tell your agent not to create large swarms of subagents and it should remember that for the rest of the session. that's usually where the cost comes from

*Applies here because prefer tightening `src/core` types, parsers, and lint-style CI checks over lengthening AGENTS.md or helper briefs. The swarm note also fits the Fable-only-orchestrator rule: helpers should be few, tightly briefed, and on Opus or Sonnet, not large unattended swarms.*

**[13 Oct 2026, 8:24 PM (America/Buenos_Aires)](https://x.com/poteto/status/2110149626133438732)**

> ban and delete most if not all code comments!
>
> agents love copying what already exists. a seemingly harmless comment explaining some temporary workaround is one of the worst viruses you can have in your codebase. like a weed it'll spread quickly as a tool for agents to quickly get their job done. before you know it, your codebase is overrun with hacks and stale comments. just one more workaround bro 
>
> you can use pstack's /no-comments skill as a weedkiller. it'll seek out useless comments while keeping the ones that actually should exist (like explaining a browser quirk), and figure out how to solve them on a first principles basis
>
> here's a prompt you can try asking @bot:
>
> create a project agent that uses /poteto-mode to spawn a /swarm to use /no-comments and identify useless code comments we can prune in my repo. come back with a high level plan of which of these workarounds would be best solved by refactoring and which we can straight up delete
>
> https://t.co/nqeRdY62ee

*Applies here because M8 includes lint-style checks; if comments or workaround notes start appearing in core modules, delete or replace them with a type, name, or test rather than leaving them as guidance for the next agent.*

Overlap: `/no-comments` is already in the repo. A short related post from 29 Oct 2026, 12:18 AM (America/Buenos_Aires), [2115644484226777581](https://x.com/poteto/status/2115644484226777581):

> @erikdunteman this is why we just banned comments in our codebase. agents love justifying their lazy hacks with comments, and before you know it the hack spreads everywhere

**[15 Oct 2026, 4:36 AM (America/Buenos_Aires)](https://x.com/poteto/status/2110635971884802049)**

> comments are unstructured text, so nothing enforces them. so if you had a comment that says “// don’t use this”, there’s a chance another agent will see it, but nothing actually enforces that that function isn’t used 
>
> a lint rule, or even better deleting that API is far more effective!

*Applies here because when a leftover API or function is obsolete after a milestone (for example after the single GM-role work in M2, or after a reducer lands), delete it rather than commenting that it should not be used.*

**[13 Oct 2026, 9:31 PM (America/Buenos_Aires)](https://x.com/poteto/status/2110166571335455209)**

> agents just do not have that level of judgment yet, even on the frontier. my whole vision is about moving things out of prose - comments, rules, skills into harder constraints and determinism where possible. it's far more token efficient and actually enforceable. 
>
> and since we have agents that can refactor code with ease, we should be taking advantage of that to clean everything up. no reason we should be living in filth any longer

*Applies here because phase 3 is allowed to clean implicit machines and leftover paths; old saves and rooms do not need to keep working.*

**[1 Nov 2026, 8:57 PM (America/Buenos_Aires)](https://x.com/poteto/status/2117043478140276847)**

> trivia:
>
> • started working on the game as a side project 4 days ago, landing ~1,150 PRs 
> • every time i found an issue in the code i asked bot to make a lint rule against it
> • used TLA+ heavily to find bugs in the game's various state machines: the story, cutscenes, the game's systems. there are many formal verification skills, one for each major system
> • i put context into the filepaths: code that runs every frame or every tick gets a .hot.ts extension, and a lint rule bans allocating in it (no object literals, closures, new, etc.), so the game loop creates almost no garbage and GC doesn't cause stutters
> • game engine is mostly custom. three.js draws the 3D scene, but the simulation, post-processing and audio are all ours
> • the simulation is fully deterministic, so every run replays exactly from its inputs. when you post a high score, the server replays your whole run to check it isn't cheated
> • we generate dynamic og:images for every run based on your final stats, and it's all localized too! the game supports 10 languages
> • my favorite feature: the music seamlessly transitions into different music for the various biomes, continuing the previous melody
> • no audio files. all the music and sound effects are synthesized live in the browser by a custom Game Boy-style chip (two pulse voices, a wave voice, noise) plus a synthwave layer. the songs are written as text in code
> • all the pixel art is code. every sprite is a file drawn with one shared palette and packed into a sprite atlas at build time
> • it runs inside an X post, from the 245px card up to full screen. the bar is 60 fps with 500 enemies on a mid-range phone
> • the build fails if the first download goes over budget. it's about 124 KB gzipped right now
> • bots play the game headless to tune each difficulty against target survival rates
> • comments are banned by a lint rule. if code needs explaining, the fix is a better name or a test

*Applies here because the useful pattern for this repo is not the game itself: encode constraints in structure (types, file layout, lint rules), add a check whenever a real bug is found, keep comments out of core, and consider one formal model per important machine (combat, gates, link/push, vitals) rather than a single catch-all skill.*

## Verification over abstract review

**[2 Nov 2026, 11:04 PM (America/Buenos_Aires)](https://x.com/poteto/status/2117437607940681849)**

> maybe a hot take but i now consider adversarial reviews mostly a waste of tokens. far better to use those tokens on empirical combined with formal verification. i have updated pstack to use the interrogate skill less, and eventually i think i may remove it altogether
>
> i have found very little value with code review in the abstract, agents tend to just get lost in the nitpicks and yagnis

*Applies here because this is already a standing rule: no adversarial review sessions; at most one second opinion, for a contested design. Spend tokens on tests, CI, and (where it pays) model checks instead.*

In a follow-up the same evening, [2117440753551204735](https://x.com/poteto/status/2117440753551204735) (2 Nov 2026, 11:16 PM (America/Buenos_Aires)):

> @Taran_Sidhu_ both, to clarify i mean just having agents review code without running it empirically or using a deterministic checker like with formal verification

**[2 Nov 2026, 11:34 PM (America/Buenos_Aires)](https://x.com/poteto/status/2117445316043825393)**

> i think you can get into overfitting or "overcooking" a PR by going through multiple rounds of abstract code review from agents. the reviewers likely have 0 context around your goals and intent, and they tend to pick up things that don't matter or steer the authoring agent in the wrong direction. and the author agent is usually too sycophantic and will accept and all feedback without really thinking about whether it makes sense

*Applies here because do not send a finished milestone through extra agent review rounds. Prove it with `bun run ci` and the unit's tests.*

**[11 Oct 2026, 9:09 PM (America/Buenos_Aires)](https://x.com/poteto/status/2109436202554372476)**

> okay now that we're past that tired discussion, let's talk about how we get agents to write more correct code (note: this won't mean the code will be Good, but it should at least work)
>
> this is the entrypoint into your most basic agentic loop: verification. it means giving your agent the ability to verify its own work, most commonly by actually running and interacting with it like a real user would. whether your interface is a cli/api/ui/whatever, you want to start here so that your agents can close the loop. if you want you can even have your agents model the problem in TLA+ and attempt to verify if you have things like state machine bugs.
>
> the point is to give yourself confidence in the agents' work by them producing some kind of artifact that proves that 1) that the work is correct, 2) that it matches what you intended, and 3) is easier to review than reading the whole PR. most commonly this would be a video and/or screenshots for UI work.
>
> everything else like skill packs are really bonus and optional, all you need is a way for your agents to verify their own work to start using them more autonomously. some caveats are that not all domains can be verified easily yet, and that verification is just approximation and can still be wrong. it's no different than trusting that a human actually ran the code they wrote and trusting it
>
> so start here!

*Applies here because a milestone is not done until a real test or run proves the behaviour, which is already how `principle-prove-it-works` and the phase 3 plan work. The formal-model option is most relevant for M6 (and optionally M3–M5 and M7).*

Overlap: this is the same thesis as `/create-verification-skill` and `principle-prove-it-works`.

**[7 Nov 2026, 12:12 AM (America/Buenos_Aires)](https://x.com/poteto/status/2118904450106654888)**

> that’s moving the goalposts 🤣
>
> the grok bot team (not just me) merged 11k PRs last month, and we release a new stable version of the client at least once a day. performance is better than it was when we launched, and our code quality is excellent. while we do make use of some automations (eg grok bots in slack that do scheduled or triggered tasks), it’s not a dark factory with no humans involved, or a centralized one where the process is very structured. 
>
> the term software factory is vaguely defined imo and is generally pitched as some kind of new thing you have to buy. not saying you do this, but that’s the impression i get of the factory space. i want to demystify what a factory is, and also help teams save money on tokens. 
>
> in my inverse pyramid i show that you can improve your agent setup dramatically by pushing stuff up into determinism - much more affordable and reproducible than spinning up agent swarms for everything. investing in fuzzing, property based testing, formal and runtime verification, refactoring, using stricter languages, etc saves you tokens in the long run. software engineers have always automated their work, agents help automate a little bit more, but fundamentally these are tools we’ve had but never had the time to explore and deploy, until now!

*Applies here because do not scale the run by spawning more Fable helpers. Push work into types, tests, and reducers; keep the lead as orchestrator and helpers limited.*

**[5 Nov 2026, 4:29 PM (America/Buenos_Aires)](https://x.com/poteto/status/2118425409276801121)**

> these are different! i should have named /create-verification-skill haha, but that's the empirical verification skill, the one that teaches agents how to run your app 
>
> the ones in my screenshot are made with /create-formal-verification-skill, which uses formal languages to prove/check certain things about your code
>
> both types work great together!

*Applies here because empirical coverage is `bun` tests plus Playwright; formal coverage, if used, is the planned model check for the link and push machines and any TLA+ or statechart work on the other reducers. Use both, not one as a substitute for the other.*

**[11 Nov 2026, 1:37 AM (America/Buenos_Aires)](https://x.com/poteto/status/2120375285724123578)**

> @robinebers it’s opt in for a reason! for me the speed gains come from parallelizing. while a single chat may take longer because of verification, I have to handhold it less, and so I can run multiple large projects simultaneously

*Applies here because a helper that takes longer because it runs tests is fine; the time saving should come from less hand-holding and from running independent units in parallel, not from skipping verification.*

## State machines and formal methods

**[5 Nov 2026, 3:52 PM (America/Buenos_Aires)](https://x.com/poteto/status/2118416074601545968)**

> while i'm quite bullish on formal methods, i think it's worth tempering expectations and doing your own research on it (disclaimer: i am not an expert in it). it cannot guarantee your code is bug free, only that it matches the spec under certain assumptions, and the specs come from what people want, not math. as long as we build software for humans, nothing can prove that your spec is right, only you can judge.
>
> i created the /statechart skill in pstack primarily because it helps make the state machines implicit in your code more obvious and legible to you, so you can shrink the review surface and review the work at a higher level: does it actually match your intent and goal? i used this skill a ton while building my game https://t.co/sa18sM28uD, below you can see the statechart for story mode where i was able to find many bugs with it. 
>
> in that sense, i think model checking (eg TLA+ with TLC) is quite useful for understanding and checking properties of your system e2e, and you don't have to write tons of new verification code for it. the spec isn't your actual code so there's always a risk of drift, but so far i've had good experiences finding actual bugs with it. i tend to pair it with empirical verification (running the code) also to confirm it's real 
>
> other types of formal verification like proving theorems (eg Lean, Dafny), bounded model checking (eg CBMC, Kani) etc have their own tradeoffs. proofs cover every possible input, but only for the properties specified, and it takes a lot more code/work. bounded model checking can run on your actual code, which avoids drift, but it only checks up to a certain number of steps, so it's better at finding bugs than proving there aren't any
>
> so i think in the near-medium term you'll still need to layer your codebase: constraints and guardrails (types, lint rules, api design, refactoring), empirical verification (tests, evals, real usage), and formal verification for the parts that really need it. none of these catch everything on their own, but layered  together, they catch a lot more and shrink what's left for you to review
>
> but also maybe in the limit, the bitter lesson will prevail and flawless code will just be printed out perfectly every time with no bugs. even in that scenario, /statechart still seems very helpful in confirming that the agent understood your intent correctly. give it a try if you haven't already! 
>
> https://t.co/9erGZLOzxO

*Applies here because this is a practical layering for the remaining milestones: types and reducers first, tests in CI next, and formal model checks for the machines that actually need them (especially M6, and optionally combat, gates, and vitals). `/statechart` can help check that a machine matches the intended player flow, but it does not replace tests, and a spec can drift from the code.*

**[8 Nov 2026, 10:48 PM (America/Buenos_Aires)](https://x.com/poteto/status/2119607908338168214)**

> i use this for end to end flows that i want to verify work correctly. for example in grok bot, i used this pattern to fix bugs with our notifications system as it was spamming people on their phones even though they were on the desktop client. i find this especially helpful when the state machine spans the network or ipc/rpc layers (hence "implicit")

Same thread, another reply, 8 Nov 2026, 10:42 PM (America/Buenos_Aires), [2119606538054840602](https://x.com/poteto/status/2119606538054840602):

> where i've found this the most useful is when i'm trying to validate some end to end part of my app. for example, user notifications across multiple clients like desktop, iOS, android and making sure you don't duplicate notifications and mark them as read correctly
>
> you can certainly do this upfront or also after the fact

*Applies here because the room protocol, two-client sync, and the link and push machines (M5 and M6) are implicit, cross-client state machines of this kind: events should not be applied twice, and clients should not diverge.*

**[8 Nov 2026, 5:02 PM (America/Buenos_Aires)](https://x.com/poteto/status/2119521036660314339)**

> try this next “use /create-formal-verification-skill to model these state machines, one skill per subsystem. and use /statechart to visualize my most important user flows”
>
> both skills are in pstack
>
> https://t.co/SxilBe4Diu https://t.co/4arc9DYbjl

*Applies here because if formal skills are added, make one per subsystem (combat, gates, link/push, vitals) rather than one skill for the whole app, matching the phase 3 module layout.*

Related, 5 Nov 2026, 4:05 PM (America/Buenos_Aires), [2118419507685544058](https://x.com/poteto/status/2118419507685544058):

> @mattlam_ in my game, every subsystem has its own formal verification skill and the agents do a good job of keeping it up to date https://t.co/bZ7fpzJWFa

**[2 Nov 2026, 11:15 PM (America/Buenos_Aires)](https://x.com/poteto/status/2117440510847803764)**

> @ncfrontiersman yeah, although the issue is the drift between the specs and the code. agents mostly do a good job keeping them in sync but it's not enforced

*Applies here because any TLA+ or statechart work should be backed by bun tests that exercise the real reducers, so a drifted spec cannot be the only check.*

**[8 Nov 2026, 10:40 PM (America/Buenos_Aires)](https://x.com/poteto/status/2119606119559782488)**

> that will create a new skill for you, eg /verify-notifications. that skill will contain a formal spec of your notifications system, stating what properties must hold true, then it will do model checking against various possible states to confirm that it's always true
>
> /statechart helps you visualize this state machine from your user's pov, so you can confirm that it's actually the right flow

*Applies here because a statechart is most useful as a check that the lead and helpers agree on the player-facing flow (room, combat, gates, hunter vitals), not as a substitute for the reducer tests.*

## Longer guides (heavy overlap with the skills)

These two X articles are the pstack guides. Most of the workflow they describe is already in `.claude/skills/` (`/create-verification-skill`, `/maintain-verification-skill`, `/in-your-own-words`, `/teach`, `/how`, `/why`, `/recall`, `/architect`, `/poteto-mode`). They are linked here so a lead can read them in full; only a few passages that add a field note are quoted. Part 3 had not been published as of this scrape.

**[The Complete Guide to pstack, Part 1 — 31 Aug 2026, 1:09 PM (America/Buenos_Aires)](https://x.com/poteto/status/2094457600259842065)** (X article)

> The most critical skill to have in your toolbox is a high quality verification skill. This skill is so important to have and maintain that I think of it more like critical infrastructure rather than "just" a skill. A good one will amplify the output of your whole team, including non-engineers. Done well, you will 100-1000x your whole team's output. 
> If you're not familiar with the term, verification means that an agent can verify its own work. It can keep going until it succeeds at its task, because it can now close the loop without you being the bottleneck.

> In pstack, we have a principle called "Build the Lever". What this means in the context of creating a skill, is that we prefer to give agents tools rather than just markdown. For verification skills, this means creating a small CLI that scripts interaction and debugging of your app in a small, agent friendly utility. This means that agents consume fewer tokens trying to do a task (run a CLI command instead of writing a throwaway script to click on something), and makes your verification skill more reproducible and testable.

*Applies here because phase 3 should keep investing in the existing test harness (`bun` tests, Playwright, `bun run ci`) the way this describes investing in a verification skill: a reproducible way for agents to close the loop, not more markdown. The "Build the Lever" point is already a pstack principle in the repo.*

**[The Complete Guide to pstack, Part 2 — 9 Sep 2026, 2:02 PM (America/Buenos_Aires)](https://x.com/poteto/status/2097732320606507506)** (X article, also at [x.com/poteto/article/2097732320606507506](https://x.com/poteto/article/2097732320606507506))

> The key lesson was that if an agent can't verify its own work, nothing else matters. You remain the bottleneck, and your whole day will be spent babysitting your agents.

> Plan Mode is often used as a way to convince yourself that the agent is going to do the right thing. But the reality is that abstract plans only give you the illusion of progress. A long and lengthy plan makes it look like you and your agent were very productive, but it's probably lacking in substance.

> In my opinion, most harnesses that have plan modes tend to over-specify implementation details and under-specify everything else. That's why in pstack, I cheekily said that "I don't believe in planning". The truth is that I do plan, but I do so through code.

*Applies here because milestone handoffs should end in a tested repo state, not a long untested plan. Designing APIs and types first (the phase 3 core layout) is planning through code.*

## Skipped, with a brief overlap note

These were scanned and left out because they mostly announce or repeat skills already in the repo, or are not durable engineering advice:

- pstack install / `/setup-pstack` / `/poteto-mode` tutorials and "try pstack" posts
- Release notes for `/statechart`, `/create-formal-verification-skill`, `/in-your-own-words`, and `/correct` (the durable advice from those posts is quoted above where it added something)
- Grok Bot product announcements, livestreams, and the AIE talk promo
- The music/video process post, except as it repeats `/sharpen` and `/in-your-own-words`, which are already in the skills
- Short social replies, jokes, and personal posts
