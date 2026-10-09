// Built-in topic knowledge for the local (offline) AI provider. Domain rules give strong signals;
// keywords give softer evidence and let pages from unrelated sites land in the same topic.
// The most specific matching domain rule wins (aws.amazon.com → Coding, amazon.com → Shopping).

import type { GroupColor } from '../shared/types';
import { stem, words } from './text';

export interface Category {
  id: string;
  name: string;
  color: GroupColor;
  /** Domain rules. "amazon.*" matches any TLD; ".edu" matches a suffix; plain domains include subdomains. */
  domains: string[];
  /** URL path prefixes on specific hosts, e.g. "linkedin.com/jobs". */
  paths?: string[];
  strong: string[];
  weak: string[];
}

export const CATEGORIES: Category[] = [
  {
    id: 'ai-research',
    name: 'AI Research',
    color: 'purple',
    domains: [
      'openreview.net', 'paperswithcode.com', 'huggingface.co', 'aclanthology.org', 'proceedings.neurips.cc', 'papers.nips.cc',
      'proceedings.mlr.press', 'distill.pub', 'deepmind.google', 'deepmind.com', 'ai.meta.com', 'research.google', 'ai.googleblog.com',
      'lilianweng.github.io', 'jalammar.github.io', 'colah.github.io', 'wandb.ai', 'alphaxiv.org', 'lmarena.ai', 'ollama.com',
      'replicate.com', 'together.ai', 'mistral.ai', 'kaggle.com', 'openai.com/research', 'anthropic.com/research', 'karpathy.ai',
      'thegradient.pub', 'bair.berkeley.edu',
    ],
    strong: [
      'llm', 'llms', 'language model', 'large language model', 'transformer', 'transformers', 'neural network', 'deep learning',
      'machine learning', 'reinforcement learning', 'rlhf', 'diffusion', 'gpt', 'bert', 'embedding', 'embeddings', 'fine-tuning',
      'finetuning', 'fine tuning', 'pretraining', 'pre-training', 'alignment', 'interpretability', 'mechanistic', 'hallucination',
      'hallucinations', 'semantic entropy', 'attention mechanism', 'self-attention', 'quantization', 'lora', 'qlora', 'multimodal',
      'vision transformer', 'gan', 'vae', 'backpropagation', 'gradient descent', 'tokenizer', 'tokenization', 'rag',
      'retrieval-augmented', 'retrieval augmented', 'chain of thought', 'in-context learning', 'prompt engineering', 'ai agent',
      'ai agents', 'agentic', 'neurips', 'icml', 'iclr', 'emnlp', 'cvpr', 'artificial intelligence', 'mixture of experts',
      'scaling laws', 'inference', 'benchmark', 'reasoning model', 'convolutional', 'cnn', 'rnn', 'lstm', 'nlp', 'computer vision',
      'pytorch', 'tensorflow', 'jax', 'model weights', 'distillation', 'contrastive', 'ai safety', 'evals', 'gemini',
      'chatgpt', 'llama', 'mistral', 'openai', 'anthropic', 'natural language', 'language generation', 'language understanding',
      'uncertainty estimation', 'linguistic', 'speech recognition', 'text-to-image', 'generative ai', 'foundation model',
      'foundation models', 'zero-shot', 'few-shot', 'instruction tuning', 'preference optimization', 'dpo', 'ppo', 'sft',
    ],
    weak: ['ai', 'ml', 'model', 'models', 'dataset', 'datasets', 'training', 'entropy', 'arxiv', 'paper', 'neural', 'agent', 'agents', 'prompt', 'semantic', 'uncertainty', 'attention', 'learning', 'generation'],
  },
  {
    id: 'research',
    name: 'Research Papers',
    color: 'cyan',
    domains: [
      'arxiv.org', 'scholar.google.com', 'semanticscholar.org', 'researchgate.net', 'sciencedirect.com', 'springer.com',
      'link.springer.com', 'nature.com', 'science.org', 'ieeexplore.ieee.org', 'dl.acm.org', 'pubmed.ncbi.nlm.nih.gov',
      'ncbi.nlm.nih.gov', 'jstor.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com', 'frontiersin.org', 'mdpi.com',
      'onlinelibrary.wiley.com', 'tandfonline.com', 'plos.org', 'journals.plos.org', 'cell.com', 'pnas.org', 'elsevier.com',
      'connectedpapers.com', 'zotero.org', 'quantamagazine.org', 'openalex.org', 'doi.org', 'acm.org', 'sagepub.com',
    ],
    strong: ['journal', 'preprint', 'peer review', 'proceedings', 'abstract', 'citation', 'citations', 'doi', 'et al', 'literature review', 'systematic review', 'meta-analysis', 'conference paper'],
    weak: ['paper', 'papers', 'study', 'research', 'survey', 'pdf', 'theory', 'analysis', 'experiment', 'hypothesis'],
  },
  {
    id: 'coding',
    name: 'Coding',
    color: 'blue',
    domains: [
      'github.com', 'gist.github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com', 'superuser.com',
      'serverfault.com', 'askubuntu.com', 'developer.mozilla.org', 'npmjs.com', 'pypi.org', 'crates.io', 'docs.rs', 'pkg.go.dev',
      'docs.python.org', 'readthedocs.io', 'readthedocs.org', 'react.dev', 'nextjs.org', 'vercel.com', 'netlify.com',
      'typescriptlang.org', 'nodejs.org', 'rust-lang.org', 'go.dev', 'kotlinlang.org', 'developer.android.com',
      'developer.apple.com', 'developer.chrome.com', 'learn.microsoft.com', 'codepen.io', 'codesandbox.io', 'replit.com',
      'jsfiddle.net', 'stackblitz.com', 'leetcode.com', 'hackerrank.com', 'codeforces.com', 'codechef.com', 'geeksforgeeks.org',
      'w3schools.com', 'devdocs.io', 'dev.to', 'hashnode.dev', 'localhost', '127.0.0.1', 'docker.com', 'hub.docker.com',
      'kubernetes.io', 'aws.amazon.com', 'console.aws.amazon.com', 'docs.aws.amazon.com', 'cloud.google.com',
      'console.cloud.google.com', 'portal.azure.com', 'supabase.com', 'firebase.google.com', 'render.com', 'railway.app',
      'fly.io', 'heroku.com', 'tailwindcss.com', 'vitejs.dev', 'vite.dev', 'svelte.dev', 'vuejs.org', 'angular.dev',
      'djangoproject.com', 'flask.palletsprojects.com', 'fastapi.tiangolo.com', 'postgresql.org', 'mongodb.com', 'redis.io',
      'sqlite.org', 'git-scm.com', 'regex101.com', 'jwt.io', 'postman.com', 'graphql.org', 'deno.com', 'bun.sh', 'expo.dev',
      'sentry.io', 'cursor.com', 'code.visualstudio.com', 'jetbrains.com', 'docs.github.com', 'platform.openai.com',
      'docs.anthropic.com', 'cloudflare.com', 'developers.cloudflare.com', 'prisma.io', 'go.dev',
      'mui.com', 'storybook.js.org', 'webpack.js.org', 'eslint.org', 'jestjs.io', 'vitest.dev', 'playwright.dev', 'pptr.dev',
    ],
    strong: [
      'api', 'sdk', 'typescript', 'javascript', 'python', 'rust', 'golang', 'java', 'kotlin', 'swift', 'react', 'vue', 'svelte',
      'nextjs', 'next.js', 'node.js', 'nodejs', 'npm', 'docker', 'kubernetes', 'git', 'github', 'repository', 'pull request',
      'commit', 'stack trace', 'compiler', 'debugging', 'exception', 'library', 'framework', 'cli', 'deploy', 'deployment',
      'backend', 'frontend', 'database', 'sql', 'regex', 'json', 'yaml', 'endpoint', 'webhook', 'async', 'runtime', 'unit test',
      'refactor', 'programming', 'coding', 'algorithm', 'leetcode', 'css', 'html', 'webassembly', 'graphql', 'rest api',
      'oauth', 'devops', 'ci/cd', 'linux', 'bash', 'terminal', 'c++', 'segmentation fault', 'null pointer', 'tailwind',
      'vite', 'webpack', 'eslint', 'postgres', 'mongodb', 'redis', 'microservices', 'serverless', 'issue', 'bug',
    ],
    weak: ['docs', 'documentation', 'reference', 'guide', 'tutorial', 'example', 'install', 'error', 'code', 'dev', 'developer', 'build', 'release', 'version', 'config', 'function', 'class', 'test', 'tests'],
  },
  {
    id: 'college',
    name: 'College',
    color: 'orange',
    domains: [
      '.edu', '.ac.uk', '.ac.in', '.edu.in', '.edu.au', '.ac.jp', '.edu.sg', 'instructure.com', 'canvas.net', 'blackboard.com',
      'brightspace.com', 'd2l.com', 'gradescope.com', 'piazza.com', 'coursera.org', 'edx.org', 'khanacademy.org', 'udemy.com',
      'quizlet.com', 'chegg.com', 'coursehero.com', 'overleaf.com', 'classroom.google.com', 'nptel.ac.in', 'swayam.gov.in',
      'studocu.com', 'brilliant.org', 'wolframalpha.com', 'desmos.com', 'symbolab.com', 'mathway.com', 'physicsclassroom.com',
      'byjus.com', 'unacademy.com', 'vedantu.com', 'ocw.mit.edu', 'moodle.org', 'collegeboard.org', 'commonapp.org',
    ],
    strong: [
      'course', 'courses', 'lecture', 'lectures', 'homework', 'assignment', 'assignments', 'syllabus', 'exam', 'exams', 'midterm',
      'quiz', 'semester', 'professor', 'university', 'college', 'campus', 'gpa', 'cgpa', 'thesis', 'dissertation', 'admission',
      'admissions', 'scholarship', 'timetable', 'attendance', 'student', 'students', 'faculty', 'enrollment', 'textbook',
      'lecture notes', 'viva', 'tutorial sheet', 'lab manual', 'practical file', 'question paper', 'previous year', 'placement',
      'internals', 'marks', 'grade', 'grades', 'study notes', 'unit test', 'class notes', 'curriculum',
    ],
    weak: ['notes', 'study', 'class', 'chapter', 'unit', 'lab', 'slides', 'ppt', 'learn', 'learning', 'solution', 'solutions', 'problem set'],
  },
  {
    id: 'shopping',
    name: 'Shopping',
    color: 'green',
    domains: [
      'amazon.*', 'ebay.*', 'etsy.com', 'walmart.com', 'target.com', 'bestbuy.com', 'aliexpress.com', 'alibaba.com',
      'flipkart.com', 'myntra.com', 'meesho.com', 'ajio.com', 'nykaa.com', 'ikea.com', 'costco.com', 'newegg.com', 'shein.com',
      'temu.com', 'zara.com', 'hm.com', 'nike.com', 'adidas.*', 'store.google.com', 'apple.com/shop', 'bigbasket.com',
      'blinkit.com', 'zeptonow.com', 'croma.com', 'reliancedigital.in', 'tatacliq.com', 'snapdeal.com', 'decathlon.*',
      'uniqlo.com', 'wayfair.com', 'homedepot.com', 'lowes.com', 'macys.com', 'nordstrom.com', 'sephora.com', 'ulta.com',
      'asos.com', 'zalando.*', 'shopee.*', 'lazada.*', 'mercadolibre.*', 'rakuten.*', 'argos.co.uk', 'currys.co.uk',
      'camelcamelcamel.com', 'slickdeals.net', 'pricehistory.app', 'swappa.com', 'backmarket.com', 'lenskart.com',
      'firstcry.com', 'pepperfry.com', 'urbanladder.com', 'jiomart.com', 'mamaearth.in', 'boat-lifestyle.com',
    ],
    strong: [
      'buy', 'price', 'prices', 'cart', 'checkout', 'deal', 'deals', 'sale', 'discount', 'coupon', 'free shipping', 'add to cart',
      'wishlist', 'in stock', 'out of stock', 'best price', 'order', 'orders', 'shop', 'store', 'shopping', 'offer', 'offers',
      'product', 'products', 'cashback', 'emi options', 'size guide', 'return policy',
    ],
    weak: ['review', 'reviews', 'specs', 'compare', 'cheap', 'best', 'laptop', 'headphones', 'shoes', 'sneakers', 'jacket', 'dress', 'watch', 'phone', 'case', 'gift', 'brand', 'rating', 'ratings'],
  },
  {
    id: 'startups',
    name: 'Startups',
    color: 'yellow',
    domains: [
      'ycombinator.com', 'news.ycombinator.com', 'producthunt.com', 'crunchbase.com', 'techcrunch.com', 'a16z.com',
      'paulgraham.com', 'wellfound.com', 'angel.co', 'angellist.com', 'sequoiacap.com', 'firstround.com', 'review.firstround.com',
      'indiehackers.com', 'pitchbook.com', 'cbinsights.com', 'saastr.com', 'lennysnewsletter.com', 'tracxn.com', 'inc42.com',
      'yourstory.com', 'entrackr.com', 'betalist.com', 'startupschool.org', 'f6s.com', 'dealroom.co', 'stripe.com/atlas',
      'foundersfund.com', 'nfx.com', 'svpg.com', 'stratechery.com', 'theinformation.com', 'carta.com',
    ],
    strong: [
      'startup', 'startups', 'founder', 'founders', 'cofounder', 'co-founder', 'fundraising', 'funding', 'seed round', 'series a',
      'series b', 'pre-seed', 'venture capital', 'vc', 'investor', 'investors', 'pitch deck', 'saas', 'mrr', 'arr',
      'product market fit', 'product-market fit', 'pmf', 'accelerator', 'incubator', 'y combinator', 'yc', 'demo day', 'equity',
      'valuation', 'term sheet', 'cap table', 'go-to-market', 'gtm', 'b2b', 'unicorn', 'bootstrapped', 'business model',
      'market size', 'tam', 'growth hacking', 'angel investor', 'launch hn', 'show hn', 'traction', 'churn', 'runway',
    ],
    weak: ['launch', 'growth', 'revenue', 'customers', 'pitch', 'raise', 'company', 'business', 'market', 'scale', 'hiring', 'team', 'product'],
  },
  {
    id: 'social',
    name: 'Social',
    color: 'pink',
    domains: [
      'x.com', 'twitter.com', 'reddit.com', 'old.reddit.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'threads.net',
      'threads.com', 'bsky.app', 'mastodon.social', 'tiktok.com', 'pinterest.com', 'quora.com', 'tumblr.com', 'snapchat.com',
      'web.telegram.org', 'lemmy.world', 'news.ycombinator.com/item',
    ],
    strong: ['tweet', 'tweets', 'subreddit', 'followers', 'retweet', 'reel', 'reels', 'thread', 'dm'],
    weak: ['post', 'comments', 'profile', 'feed', 'community'],
  },
  {
    id: 'media',
    name: 'Video & Music',
    color: 'red',
    domains: [
      'youtube.com', 'youtu.be', 'm.youtube.com', 'vimeo.com', 'twitch.tv', 'netflix.com', 'primevideo.com', 'hotstar.com',
      'disneyplus.com', 'hulu.com', 'max.com', 'spotify.com', 'music.apple.com', 'soundcloud.com', 'music.youtube.com',
      'jiosaavn.com', 'gaana.com', 'crunchyroll.com', 'dailymotion.com', 'imdb.com', 'letterboxd.com', 'rottentomatoes.com',
      'jiocinema.com', 'sonyliv.com', 'zee5.com', 'audible.com', 'podcasts.apple.com', 'tv.apple.com', 'bandcamp.com',
    ],
    strong: ['video', 'episode', 'season', 'trailer', 'movie', 'film', 'music', 'song', 'album', 'playlist', 'podcast', 'livestream', 'official video', 'lyrics', 'full movie', 'web series', 'anime'],
    weak: ['watch', 'stream', 'live', 'listen', 'clip', 'shorts', 'channel'],
  },
  {
    id: 'news',
    name: 'News & Reading',
    color: 'grey',
    domains: [
      'nytimes.com', 'bbc.com', 'bbc.co.uk', 'theguardian.com', 'reuters.com', 'apnews.com', 'bloomberg.com', 'wsj.com', 'ft.com',
      'cnn.com', 'washingtonpost.com', 'theverge.com', 'wired.com', 'arstechnica.com', 'engadget.com', 'theatlantic.com',
      'newyorker.com', 'economist.com', 'medium.com', 'substack.com', 'hindustantimes.com', 'thehindu.com', 'indianexpress.com',
      'timesofindia.indiatimes.com', 'ndtv.com', 'livemint.com', 'economictimes.indiatimes.com', 'aljazeera.com', 'axios.com',
      'politico.com', 'vox.com', 'npr.org', 'cnbc.com', 'forbes.com', 'businessinsider.com', 'theprint.in', 'scroll.in',
      'news.google.com', 'techmeme.com', 'gizmodo.com', '9to5mac.com', '9to5google.com', 'macrumors.com', 'theregister.com',
    ],
    strong: ['news', 'breaking', 'opinion', 'editorial', 'newsletter', 'election', 'government', 'policy', 'headlines', 'live updates', 'exclusive', 'report says'],
    weak: ['article', 'blog', 'report', 'analysis', 'interview', 'story', 'essay', 'read', 'today'],
  },
  {
    id: 'work',
    name: 'Docs & Work',
    color: 'blue',
    domains: [
      'docs.google.com', 'drive.google.com', 'sheets.google.com', 'slides.google.com', 'notion.so', 'notion.site', 'airtable.com',
      'trello.com', 'asana.com', 'linear.app', 'atlassian.net', 'atlassian.com', 'monday.com', 'clickup.com', 'miro.com',
      'dropbox.com', 'onedrive.live.com', 'office.com', 'sharepoint.com', 'calendar.google.com', 'mail.google.com',
      'outlook.office.com', 'outlook.live.com', 'slack.com', 'app.slack.com', 'zoom.us', 'meet.google.com', 'teams.microsoft.com',
      'loom.com', 'calendly.com', 'todoist.com', 'evernote.com', 'obsidian.md', 'coda.io', 'basecamp.com', 'hubspot.com',
      'salesforce.com', 'zendesk.com', 'intercom.com', 'docusign.com', 'typeform.com', 'forms.google.com',
    ],
    strong: ['spreadsheet', 'meeting', 'agenda', 'roadmap', 'sprint', 'ticket', 'okr', 'okrs', 'standup', 'quarterly', 'invoice', 'proposal', 'minutes', 'onboarding', 'kanban', 'deadline', 'stakeholder', 'inbox'],
    weak: ['doc', 'document', 'sheet', 'slides', 'presentation', 'notes', 'task', 'tasks', 'project', 'board', 'calendar', 'schedule', 'planning', 'todo', 'plan', 'team', 'draft'],
  },
  {
    id: 'finance',
    name: 'Finance',
    color: 'green',
    domains: [
      'robinhood.com', 'coinbase.com', 'binance.com', 'zerodha.com', 'kite.zerodha.com', 'groww.in', 'upstox.com',
      'tradingview.com', 'finance.yahoo.com', 'investing.com', 'moneycontrol.com', 'paypal.com', 'wise.com', 'revolut.com',
      'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'hdfcbank.com', 'icicibank.com', 'sbi.co.in', 'onlinesbi.sbi',
      'axisbank.com', 'kotak.com', 'paytm.com', 'phonepe.com', 'razorpay.com', 'ynab.com', 'etoro.com', 'coinmarketcap.com',
      'coingecko.com', 'morningstar.com', 'fidelity.com', 'vanguard.com', 'schwab.com', 'incometax.gov.in', 'irs.gov',
      'cleartax.in', 'creditkarma.com', 'nerdwallet.com', 'valueresearchonline.com', 'screener.in', 'tickertape.in',
    ],
    strong: ['stock', 'stocks', 'shares', 'investing', 'investment', 'portfolio', 'mutual fund', 'mutual funds', 'sip', 'etf', 'crypto', 'bitcoin', 'ethereum', 'trading', 'nifty', 'sensex', 'nasdaq', 'dividend', 'tax return', 'itr', 'income tax', 'banking', 'loan', 'emi', 'credit card', 'credit score', 'budget', 'expense', 'expenses', 'upi', 'interest rate', 'insurance', 'net worth', 'ipo'],
    weak: ['invest', 'market', 'bank', 'money', 'salary', 'payment', 'tax', 'taxes', 'finance', 'financial', 'savings'],
  },
  {
    id: 'travel',
    name: 'Travel',
    color: 'cyan',
    domains: [
      'booking.com', 'airbnb.*', 'expedia.*', 'kayak.*', 'skyscanner.*', 'google.com/travel', 'google.com/flights', 'tripadvisor.*',
      'makemytrip.com', 'goibibo.com', 'cleartrip.com', 'irctc.co.in', 'ixigo.com', 'agoda.com', 'hotels.com', 'trivago.*',
      'redbus.in', 'lonelyplanet.com', 'rome2rio.com', 'marriott.com', 'hilton.com', 'delta.com', 'united.com', 'goindigo.in',
      'airindia.com', 'emirates.com', 'aa.com', 'ryanair.com', 'easyjet.com', 'hostelworld.com', 'vrbo.com', 'oyorooms.com',
      'yatra.com', 'easemytrip.com', 'seatguru.com', 'flightradar24.com', 'maps.google.com', 'google.com/maps',
    ],
    strong: ['flight', 'flights', 'hotel', 'hotels', 'itinerary', 'visa', 'passport', 'airport', 'resort', 'hostel', 'vacation', 'holiday', 'boarding pass', 'check-in', 'round trip', 'one way', 'travel insurance', 'things to do', 'road trip'],
    weak: ['trip', 'travel', 'booking', 'train', 'tickets', 'destination', 'tour', 'beach', 'map', 'directions'],
  },
  {
    id: 'jobs',
    name: 'Jobs & Career',
    color: 'orange',
    domains: [
      'indeed.*', 'glassdoor.*', 'naukri.com', 'internshala.com', 'lever.co', 'jobs.lever.co', 'greenhouse.io',
      'boards.greenhouse.io', 'myworkdayjobs.com', 'ashbyhq.com', 'jobs.ashbyhq.com', 'unstop.com', 'levels.fyi',
      'teamblind.com', 'monster.com', 'ziprecruiter.com', 'simplyhired.com', 'hirist.tech', 'instahyre.com', 'cutshort.io',
      'workatastartup.com', 'smartrecruiters.com', 'jobvite.com', 'icims.com', 'otta.com', 'welcometothejungle.com',
      'foundit.in', 'apna.co', 'triplebyte.com',
    ],
    paths: ['linkedin.com/jobs', 'wellfound.com/jobs', 'wellfound.com/role', 'ycombinator.com/companies'],
    strong: ['job', 'jobs', 'career', 'careers', 'hiring', 'apply now', 'job application', 'resume', 'cover letter', 'interview prep', 'internship', 'internships', 'intern', 'recruiter', 'job opening', 'vacancy', 'offer letter', 'referral', 'salary negotiation', 'job description', 'we are hiring', 'remote job', 'full-time', 'part-time'],
    weak: ['apply', 'application', 'cv', 'interview', 'salary', 'role', 'position', 'opening', 'placement', 'portfolio'],
  },
  {
    id: 'design',
    name: 'Design',
    color: 'pink',
    domains: [
      'figma.com', 'dribbble.com', 'behance.net', 'awwwards.com', 'mobbin.com', 'coolors.co', 'fonts.google.com', 'fontshare.com',
      'unsplash.com', 'pexels.com', 'canva.com', 'framer.com', 'webflow.com', 'spline.design', 'lottiefiles.com', 'icons8.com',
      'flaticon.com', 'thenounproject.com', 'uxdesign.cc', 'nngroup.com', 'material.io', 'm3.material.io', 'refactoringui.com',
      'siteinspire.com', 'land-book.com', 'godly.website', 'lapa.ninja', 'fontsinuse.com', 'designsystems.com', 'adobe.com',
    ],
    strong: ['design', 'ui', 'ux', 'typography', 'font', 'fonts', 'color palette', 'palette', 'mockup', 'wireframe', 'prototype', 'illustration', 'logo', 'branding', 'design system', 'landing page', 'figma', 'user experience', 'user interface', 'moodboard'],
    weak: ['icon', 'icons', 'inspiration', 'layout', 'style', 'visual', 'color', 'colors', 'gradient', 'template', 'templates'],
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

// ---------- compiled matchers ----------

interface DomainRule {
  cat: string;
  kind: 'exact' | 'anyTld' | 'suffix' | 'path';
  value: string;
  specificity: number;
}

const DOMAIN_RULES: DomainRule[] = [];
for (const c of CATEGORIES) {
  for (const d of c.domains) {
    if (d.startsWith('.')) DOMAIN_RULES.push({ cat: c.id, kind: 'suffix', value: d, specificity: d.length });
    else if (d.endsWith('.*')) DOMAIN_RULES.push({ cat: c.id, kind: 'anyTld', value: d.slice(0, -2), specificity: d.length });
    else if (d.includes('/')) DOMAIN_RULES.push({ cat: c.id, kind: 'path', value: d, specificity: d.length + 10 });
    else DOMAIN_RULES.push({ cat: c.id, kind: 'exact', value: d, specificity: d.length });
  }
  for (const p of c.paths ?? []) DOMAIN_RULES.push({ cat: c.id, kind: 'path', value: p, specificity: p.length + 20 });
}

function ruleMatches(rule: DomainRule, host: string, hostPath: string): boolean {
  switch (rule.kind) {
    case 'exact':
      return host === rule.value || host.endsWith('.' + rule.value);
    case 'suffix':
      return host.endsWith(rule.value);
    case 'anyTld': {
      const labels = host.split('.');
      const i = labels.indexOf(rule.value);
      // amazon.com, amazon.co.uk, smile.amazon.de, but not amazonaws.com
      return i >= 0 && labels.length - i <= 3 && labels.length - i >= 2;
    }
    case 'path':
      return hostPath.startsWith(rule.value) || hostPath.includes('.' + rule.value);
  }
}

/** Category of the most specific domain rule matching this URL, if any. */
export function domainCategory(url: string): string | null {
  let host = '';
  let hostPath = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    hostPath = host + u.pathname.toLowerCase();
  } catch {
    return null;
  }
  let best: DomainRule | null = null;
  for (const r of DOMAIN_RULES) {
    if (ruleMatches(r, host, hostPath) && (!best || r.specificity > best.specificity)) best = r;
  }
  return best?.cat ?? null;
}

interface KeywordIndex {
  single: Map<string, Array<{ cat: string; weight: number }>>;
  phrases: Array<{ phrase: string; cat: string; weight: number }>;
}

function buildKeywordIndex(): KeywordIndex {
  const single = new Map<string, Array<{ cat: string; weight: number }>>();
  const phrases: KeywordIndex['phrases'] = [];
  const add = (kw: string, cat: string, weight: number) => {
    const toks = words(kw);
    if (toks.length === 1 && !/[^a-z0-9]/.test(kw.replace(/\s/g, ''))) {
      const key = stem(toks[0]);
      const list = single.get(key) ?? [];
      list.push({ cat, weight });
      single.set(key, list);
    } else {
      phrases.push({ phrase: kw.toLowerCase(), cat, weight });
    }
  };
  for (const c of CATEGORIES) {
    for (const k of c.strong) add(k, c.id, 0.6);
    for (const k of c.weak) add(k, c.id, 0.22);
  }
  return { single, phrases };
}

const KEYWORDS = buildKeywordIndex();

export interface CategoryScore {
  id: string;
  score: number;
  hits: string[];
}

/** Score every category for a page. Domain match is strong evidence; keywords accumulate (capped). */
export function scoreCategories(text: string, url: string): CategoryScore[] {
  const scores = new Map<string, CategoryScore>();
  const bump = (cat: string, amount: number, hit: string) => {
    const s = scores.get(cat) ?? { id: cat, score: 0, hits: [] };
    s.score += amount;
    if (s.hits.length < 6 && !s.hits.includes(hit)) s.hits.push(hit);
    scores.set(cat, s);
  };
  const dc = domainCategory(url);
  // Local dev servers host anything, so they only weakly suggest Coding.
  const loopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
  if (dc) bump(dc, loopback ? 0.45 : 1.2, loopback ? 'local server' : 'site');
  const lower = ` ${text.toLowerCase()} `;
  const seen = new Set<string>();
  for (const w of words(text)) {
    const key = stem(w);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const { cat, weight } of KEYWORDS.single.get(key) ?? []) bump(cat, weight, w);
  }
  for (const { phrase, cat, weight } of KEYWORDS.phrases) {
    if (lower.includes(phrase)) bump(cat, weight * 1.15, phrase);
  }
  for (const s of scores.values()) {
    // Diminishing returns on keyword piles; the site signal stays intact.
    const site = s.hits.includes('site') ? 1.2 : 0;
    s.score = site + Math.min(1.6, s.score - site);
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

export interface Classification {
  id: string;
  name: string;
  confidence: number;
  hits: string[];
}

/** Confident single category for a page, or null when the evidence is weak or split. */
export function classify(text: string, url: string): Classification | null {
  const scores = scoreCategories(text, url);
  const top = scores[0];
  if (!top || top.score < 0.6) return null;
  const second = scores[1]?.score ?? 0;
  if (top.score - second < 0.15 && !top.hits.includes('site')) return null;
  const cat = CATEGORY_BY_ID.get(top.id)!;
  // AI-flavoured research papers belong to AI Research.
  if (top.id === 'research') {
    const ai = scores.find((s) => s.id === 'ai-research');
    if (ai && ai.score >= 0.4) {
      const aiCat = CATEGORY_BY_ID.get('ai-research')!;
      return { id: aiCat.id, name: aiCat.name, confidence: Math.min(1, (ai.score + 0.6) / 1.6), hits: ai.hits };
    }
  }
  return { id: cat.id, name: cat.name, confidence: Math.min(1, (top.score - second * 0.5) / 1.4), hits: top.hits };
}
