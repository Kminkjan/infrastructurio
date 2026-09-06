# Vision and Scope

Direction agreed with the project owner on 2026-09-06.

**You design the infrastructure. The world builds around it and decides how to use it.**

## Player fantasy

Spend most of play drawing and refining roads, junctions, tracks and stations. Watch autonomous traffic use those designs, development discover new opportunities, and success generate the next transport problem. A useful connection can attract an industry; its trucks can expose a poor merge; a redesigned junction can change where housing becomes attractive.

The exact design matters. Two junctions with equal lane counts can have different throughput, queues and reliability because of turning movements, priorities and geometry. Railway switches, platform access and signals should ultimately matter in the same way.

## Agreed player and simulation responsibilities

| Player designs and controls | Simulation decides and operates |
| --- | --- |
| Freeform roads, curves, lane counts, lane connections and priorities | Private vehicle demand, destinations, routes and departures |
| Bridges, underpasses, major corridors and junctions | Merging, queuing, lane use and experienced journey times |
| Rail tracks, switches, platforms, stations and signals | Operator service viability, routes, frequency, train size and dispatch |
| Local street constraints and redesign of existing streets | Town-built local streets within those constraints |
| Infrastructure investment and land use constraints | Housing, commerce and industry responding to accessibility |

The player never needs to purchase vehicles, create transport lines, set timetables, assign fleets or dispatch trains. Services are fully autonomous and inspectable. Subsidies and service requests are outside this prototype.

Detailed controls have useful defaults and presets. Simple construction should work immediately; precision tools should reward deliberate refinement.

## Design pillars

- Infrastructure design is the main activity. Regional simulation creates reasons to design and revisit it.
- Traffic has causal behaviour. Vehicles occupy lanes, queue and merge; experienced delay and delivery reliability affect accessibility and growth.
- The world has its own initiative. Operators establish, change or withdraw services; towns extend streets; development chooses among locations.
- Growth has a geography. Access to workers, customers and goods supports distinct residential, commercial and industrial places.
- Decisions are inspectable. Show why a route, development or service was chosen, including why nothing happened.
- Success creates changing demand. Growth feeds trips back into the network, with slower construction and decline rather than instant relocation.
- Constraints are forgiving but meaningful. Land, construction and maintenance matter without frequent financial failure.

Representative vehicles may stand for multiple trips, provided weighting does not break physical queues, flow accounting or the consequences of design. Persistent identities for every citizen are unnecessary.

## Next prototype contract

A small region with a few settlements and industries. First prove an open-ended road design → growth → congestion → redesign loop, with no prescribed winning solution. Then add a bounded railway proof within the same roadmap. Road construction includes editable curves, snapping and grade separation. Readable stylized presentation comes first; a short comparative evaluation will decide whether to retain 2D or adopt 3D.

See [the prototype plan](next-prototype-plan.md) for delivery gates and [the roadmap](../ROADMAP.md) for milestones.

## Scope boundaries

Defer comprehensive production chains, municipal service management, huge maps, every-trip citizen simulation, multiplayer, utilities, mod support and a large transport catalogue. Rail belongs in this prototype roadmap, after the road loop. Do not expand the old guided scenario as the next product target.

## Inspiration

[Highways & Co.](https://store.steampowered.com/app/5096600/Highways__Co/) provides a reference for road and junction design. Our distinct objective is infrastructure-driven autonomous development and transport operation. Its store description is a reference, not evidence of implementation details or a commitment to copy its appearance.
