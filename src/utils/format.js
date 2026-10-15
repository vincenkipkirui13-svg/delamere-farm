function formatDate(value) {
  if (!value) return '';
  const date = new Date(value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).format(date);
}

function truncate(text, max = 120) {
  const value = String(text || '');
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

// Replace the temporary third-party stock-photo fallbacks with the farm's
// repository-hosted livestock photos. Custom uploaded paths and custom URLs
// remain untouched; these mappings only apply to the old seeded Wikimedia URLs.
function resolveImagePath(image, fallback) {
  if (!image) return fallback;
  const value = String(image).trim();
  if (/^https:\/\/(?:commons\.wikimedia\.org|upload\.wikimedia\.org)\//i.test(value)) {
    const photo = value.toLowerCase();
    if (photo.includes('goat_farming')) return '/animal-photos/goats/boer/boer-01.jfif';
    if (photo.includes('sheep_farm') || photo.includes('sheep_flock')) return '/animal-photos/sheep/red-maasai/red-maasai-01.jfif';
    if (photo.includes('cattle_barn')) return '/animal-photos/cattle/ayrshire/ayrshire-01.jfif';
    if (photo.includes('farm_in_the_field')) return '/animal-photos/cattle/sahiwal/sahiwal-01.jfif';
    if (photo.includes('livestock_farming')) return '/animal-photos/cattle/brahman/brahman-01.jfif';
    if (photo.includes('wisconsin_dairy_farm')) return '/animal-photos/cattle/friesian-holstein/friesian-holstein-03.jfif';
    // Do not substitute an unrelated livestock photo for an actual product photo.
    if (photo.includes('bottle_of_milk') || photo.includes('yogurt')) return '/images/placeholder.svg';
    if (photo.includes('dairy_products_in_a_grocery')) return '/images/placeholder.svg';
    return '/animal-photos/cattle/friesian-holstein/friesian-holstein-03.jfif';
  }
  // Preserve explicitly configured external image URLs instead of treating them
  // as local upload filenames (which made valid custom photos appear broken).
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return value;
  if (value.startsWith('uploads/')) return `/${value}`;
  return `/uploads/${value}`;
}

function imageUrl(image) {
  return resolveImagePath(image, '/images/placeholder.svg');
}

function mediaUrl(image, fallback = '/animal-photos/cattle/friesian-holstein/friesian-holstein-03.jfif') {
  return resolveImagePath(image, fallback);
}

module.exports = { formatDate, truncate, imageUrl, mediaUrl };

function whatsappUrl(number, text) {
  let value = String(number || '').replace(/[^0-9]/g, '');

  if (value.startsWith('00')) {
    value = value.slice(2);
  }

  if (value.startsWith('0')) {
    value = '254' + value.slice(1);
  }

  if (!value) return '#';

  if (!text) {
    text = 'Hello Delamere Farm, I would like to make an inquiry.';
  }

  return 'https://wa.me/' + value + '?text=' + encodeURIComponent(text);
}

module.exports.whatsappUrl = whatsappUrl;
