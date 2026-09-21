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

function imageUrl(image) {
  return image ? `/uploads/${image}` : '/images/placeholder.svg';
}

function mediaUrl(image, fallback = '/images/farm-placeholder.svg') {
  return image ? `/uploads/${image}` : fallback;
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