/**
 * Seed script — Nepal Grand Tihar Festival 2026
 * Participant data extracted verbatim from the official participant sheet
 * (upload/festiv.jpg). Spelling, order and grouping are preserved exactly.
 * Entries marked with "—" in the affiliation column have affiliation: null.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// category: section header in the official sheet
// performance: "Performance" column · name: "Participant / Group" column
// members: "Members" column · affiliation: "Affiliation" column
// classification: derived only when the sheet states Solo/Group or lists members
const participants = [
  // ---- 1. SINGING -----------------------------------------------------------
  { performance: 'Live Singing', name: 'Shakti Man Tamang', members: null, affiliation: 'KSU', category: 'SINGING', classification: 'SOLO' },
  { performance: 'Singing', name: 'Samin Yakka', members: null, affiliation: 'BIST', category: 'SINGING', classification: 'SOLO' },
  { performance: 'Group Live Singing', name: 'Dong & Band', members: 'Sujal Dong; Sishir Ranavat; Kushal Pariyar', affiliation: null, category: 'SINGING', classification: 'GROUP' },
  { performance: 'Live Singing', name: 'Thapa Manjil', members: null, affiliation: 'KSU', category: 'SINGING', classification: 'SOLO' },
  { performance: 'Group Performance', name: 'Himalayan Jam', members: 'Youg KC; Nischal Sunar; Rajesh Pariyar', affiliation: null, category: 'SINGING', classification: 'GROUP' },
  // ---- 2. DANCE -------------------------------------------------------------
  { performance: 'Group Performance', name: 'Triple A', members: 'Aayusha Thapa; Ajence Sherpa; Aakash Suyal', affiliation: 'TU & Dong-Eui University', category: 'DANCE', classification: 'GROUP' },
  { performance: 'Dance', name: 'Pratikshya Rai', members: null, affiliation: 'KSU', category: 'DANCE', classification: 'SOLO' },
  { performance: 'Group Performance', name: 'Team Incomprehensible', members: 'Prince Lama; Jenny Moon', affiliation: 'Dong-Eui University', category: 'DANCE', classification: 'GROUP' },
  { performance: 'Dance', name: 'Sandesh Darnal & Basanti', members: null, affiliation: 'TU', category: 'DANCE', classification: 'GROUP' },
  { performance: 'Dance', name: 'Sandipa Bika', members: null, affiliation: 'BIST', category: 'DANCE', classification: 'SOLO' },
  { performance: 'Dance', name: 'Apekshya Rumba', members: null, affiliation: 'BUFS', category: 'DANCE', classification: 'SOLO' },
  { performance: 'Dance', name: 'Sherpa Shiwani & Sabin Dong', members: null, affiliation: 'TU', category: 'DANCE', classification: 'GROUP' },
  // ---- 3. RAP ---------------------------------------------------------------
  { performance: 'Rap', name: 'Hukum Bdr', members: null, affiliation: 'BIST', category: 'RAP', classification: 'SOLO' },
  // ---- 4. BEATBOXING --------------------------------------------------------
  { performance: 'Beatboxing', name: 'Buddha Lama', members: null, affiliation: 'BUFS', category: 'BEATBOXING', classification: 'SOLO' },
  // ---- 5. INSTRUMENTAL PERFORMANCE -----------------------------------------
  { performance: 'Instrumental', name: 'Nabin Belbase', members: null, affiliation: 'Tongmyong University', category: 'INSTRUMENTAL', classification: 'SOLO' },
  // ---- OTHER CULTURAL PERFORMANCES ------------------------------------------
  { performance: 'Welcome Dance', name: 'Pranisha & Group', members: null, affiliation: 'KSU', category: 'CULTURAL', classification: 'GROUP' },
  { performance: 'Dance', name: 'Barsha Thapa', members: null, affiliation: 'BIST', category: 'CULTURAL', classification: 'SOLO' },
  { performance: 'Dance', name: 'NCB Crew & Ena Gurung', members: null, affiliation: null, category: 'CULTURAL', classification: 'GROUP' },
  { performance: 'Dance', name: 'Team Asmita', members: 'Asmita Gurung & Pyari Gurung', affiliation: 'KSU', category: 'CULTURAL', classification: 'GROUP' },
  { performance: 'Dance', name: 'Lama Maya', members: null, affiliation: 'TU', category: 'CULTURAL', classification: 'SOLO' },
  { performance: 'Dance', name: 'Bhumika Oli', members: null, affiliation: 'KSU', category: 'CULTURAL', classification: 'SOLO' },
  { performance: 'Dance', name: 'Nisha Dimdum', members: null, affiliation: 'KSU', category: 'CULTURAL', classification: 'SOLO' },
  { performance: 'Dance', name: 'Rupa Kumari Chaulagain', members: null, affiliation: null, category: 'CULTURAL', classification: 'SOLO' },
  { performance: 'Group Dance', name: 'Team Aashika', members: 'Kumal Aashika, Giri Samikshya & Bhandari Priti', affiliation: null, category: 'CULTURAL', classification: 'GROUP' },
  { performance: 'Group Dance', name: 'Shuva Team', members: null, affiliation: null, category: 'CULTURAL', classification: 'GROUP' },
  { performance: 'Sing', name: 'Shrestha Rubi', members: null, affiliation: 'KSU', category: 'CULTURAL', classification: 'SOLO' },
  { performance: 'Band Performance', name: 'Dong & Band', members: 'Sujal Dong; Sishir Ranavat; Kushal Pariyar', affiliation: 'KSU', category: 'CULTURAL', classification: 'GROUP' },
  { performance: 'Sing', name: 'Roshan Koirala', members: null, affiliation: 'Dong-A University', category: 'CULTURAL', classification: 'SOLO' },
  { performance: 'Rap', name: 'Ram Nabin', members: null, affiliation: 'BIST', category: 'CULTURAL', classification: 'SOLO' },
]

async function main() {
  console.log(`Seeding ${participants.length} participants…`)

  // Idempotent: replace participant list if empty or if explicitly forced via --force
  const existing = await db.participant.count()
  if (existing > 0 && !process.argv.includes('--force')) {
    console.log(`Participants already seeded (${existing}). Use --force to reseed.`)
  } else {
    if (existing > 0) {
      const votes = await db.vote.count()
      if (votes > 0) {
        console.error('Refusing to reseed: votes exist. Reset votes first.')
        process.exit(1)
      }
      await db.participant.deleteMany()
    }
    await db.participant.createMany({
      data: participants.map((p, i) => ({ ...p, sortOrder: i + 1 })),
    })
    console.log(`Created ${participants.length} participants.`)
  }

  // Single authoritative voting-config row (starts CLOSED)
  await db.votingConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, status: 'CLOSED', closedPermanently: false },
  })

  const counts = await db.participant.groupBy({ by: ['category'], _count: true, orderBy: { category: 'asc' } })
  for (const c of counts) console.log(`  ${c.category ?? '—'}: ${c._count}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
