// Topics a learner can pick with /topic: the classic A2 syllabus areas
// (Cambridge A2 Key / CEFR-J themes). A topic runs for a week; every day of
// the week has its own focus so the week doesn't feel repetitive.
export type Topic = { id: string; label: string; name: string; focuses: string[] };

export const MIX = 'mix';

export const TOPICS: Topic[] = [
  {
    id: 'food',
    label: '🍝 Food & cooking',
    name: 'Food and cooking',
    focuses: ['At the supermarket', 'Cooking at home', 'In a restaurant or café', 'Breakfast, lunch and dinner', 'Healthy eating', 'Tastes and flavours', 'Food from different countries'],
  },
  {
    id: 'travel',
    label: '✈️ Travel & holidays',
    name: 'Travel and holidays',
    focuses: ['Planning a trip', 'At the airport', 'Hotels and booking', 'Sightseeing', 'Packing and luggage', 'Problems on holiday', 'Telling friends about a trip'],
  },
  {
    id: 'shopping',
    label: '🛍 Shopping & money',
    name: 'Shopping and money',
    focuses: ['Clothes shopping', 'Prices and paying', 'Shopping online', 'Returning things', 'Markets and small shops', 'Saving and spending money', 'Presents and gifts'],
  },
  {
    id: 'work',
    label: '💼 Work & jobs',
    name: 'Work and jobs',
    focuses: ['Jobs and workplaces', 'A day at work', 'Colleagues and the boss', 'Emails and meetings', 'Looking for a job', 'Skills and experience', 'Work–life balance'],
  },
  {
    id: 'home',
    label: '🏠 Home & daily life',
    name: 'Home and daily life',
    focuses: ['Rooms and furniture', 'My daily routine', 'Housework', 'Neighbours', 'Renting a flat', 'Problems at home', 'Weekends at home'],
  },
  {
    id: 'people',
    label: '👨‍👩‍👧 Family & friends',
    name: 'Family and friends',
    focuses: ['My family', 'Family events', 'Keeping in touch', 'Making friends', 'Invitations and parties', 'Celebrations', 'Relationships and help'],
  },
  {
    id: 'looks',
    label: '🪞 Appearance & personality',
    name: 'Appearance and personality',
    focuses: ['Face and hair', 'Height, build and age', 'Clothes and style', 'Describing someone you know', 'Personality: good qualities', 'Personality: bad habits', 'First impressions'],
  },
  {
    id: 'health',
    label: '🩺 Health & body',
    name: 'Health and the body',
    focuses: ['Parts of the body', 'Feeling ill', 'At the doctor', 'At the pharmacy', 'Sleep and stress', 'Sport and staying fit', 'Healthy habits'],
  },
  {
    id: 'hobbies',
    label: '🎬 Free time & hobbies',
    name: 'Free time and hobbies',
    focuses: ['Films and series', 'Music', 'Books and reading', 'Sport as a hobby', 'Games', 'Going out', 'Learning something new'],
  },
  {
    id: 'city',
    label: '🏙 City & transport',
    name: 'The city and transport',
    focuses: ['Places in a city', 'Asking for directions', 'Public transport', 'Driving and cycling', 'Services: bank, post office', 'City or countryside', 'My neighbourhood'],
  },
  {
    id: 'tech',
    label: '📱 Technology',
    name: 'Technology and the internet',
    focuses: ['Phones and apps', 'Messages and social media', 'Computers and problems', 'Online safety', 'Technology at work and school', 'Smart home', 'Life without the internet'],
  },
];

export const MIX_LABEL = '🎲 Mix — a new topic every day';

export function topicLabel(id: string): string {
  return TOPICS.find((t) => t.id === id)?.label ?? MIX_LABEL;
}

// Used by the “Mix” option: one of these per day. Each comes back roughly
// every six weeks, but always with new words (see used_words).
export const MIX_THEMES = [
  'Food and cooking',
  'Shopping and money',
  'Travel and holidays',
  'Weather and seasons',
  'Home and furniture',
  'Family and friends',
  'Work and jobs',
  'Health and the body',
  'Sport and fitness',
  'Free time and hobbies',
  'In the city',
  'Transport',
  'School and learning',
  'Clothes and fashion',
  'Feelings and personality',
  'Technology and the internet',
  'Nature and animals',
  'Restaurants and cafés',
  'Daily routine',
  'Films, music and books',
  'Celebrations and holidays',
  'At the doctor',
  'Hotels and booking',
  'Directions and places',
  'Plans and the future',
  'Past experiences and memories',
  'Jobs around the house',
  'Environment',
  'News and media',
  'Problems and solutions',
  'Describing people',
  'The countryside',
  'Phone calls and messages',
  'Parties and invitations',
  'Rules and advice',
  'Childhood',
  'Neighbours and community',
  'Small talk',
  'Time and dates',
  'Airports and flights',
];
