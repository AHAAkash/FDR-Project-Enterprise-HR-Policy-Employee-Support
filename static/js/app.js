const chat = document.getElementById('chat');
const form = document.getElementById('chatForm');
const question = document.getElementById('question');
const trace = document.getElementById('trace');
const sourceUsed = document.getElementById('sourceUsed');
const sourceDescription = document.getElementById('sourceDescription');
const sendButton = form.querySelector('button[type="submit"]');
const modal = document.getElementById('uploadModal');
const uploadButton = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');
const uploadStatus = document.getElementById('uploadStatus');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const initialMessage = chat.innerHTML;
const sourceDetails = {
  private_kb: 'Based on company HR knowledge',
  web_search: 'External information; confirm with HR',
  direct: 'General conversation',
  insufficient_evidence: 'No reliable source found',
  web: 'External information; confirm with HR',
  running: 'Checking your company knowledge first',
  error: 'The request could not be completed',
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function formatText(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function playMotion(element, frames, options = {}) {
  if (!element || reducedMotion || typeof element.animate !== 'function') return;
  element.animate(frames, {
    duration: 360,
    easing: 'cubic-bezier(.2,.8,.2,1)',
    fill: 'both',
    ...options,
  });
}

function setSource(value, description = '') {
  sourceUsed.textContent = value || 'Waiting for your question';
  sourceDescription.textContent = description || sourceDetails[value] || 'Your answer source will appear here.';
}

function addMessage(role, text, source = '', citations = []) {
  const message = document.createElement('div');
  message.className = `message ${role}`;

  const citationMarkup = citations.length
    ? `<div class="citations"><strong>Sources</strong>${citations.map(citation => (
      citation.url
        ? `<a href="${escapeHtml(citation.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(citation.title || citation.url)}</a>`
        : `<span class="citation-link">${escapeHtml(citation.title || 'Company document')}</span>`
    )).join('')}</div>`
    : '';
  const avatar = role === 'assistant'
    ? '<div class="avatar assistant-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 14.5 9.5 20.5 12l-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5 2.5-6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></div>'
    : '<div class="avatar user-avatar" aria-hidden="true">YOU</div>';
  const sourceMarkup = source ? `<div class="answer-source">${escapeHtml(source.replaceAll('_', ' '))}</div>` : '';

  message.innerHTML = `${avatar}<div class="bubble">${formatText(text)}${sourceMarkup}${citationMarkup}</div>`;
  chat.appendChild(message);
  playMotion(message, [
    { opacity: 0, transform: `translateY(9px) ${role === 'user' ? 'translateX(6px)' : 'translateX(-6px)'}` },
    { opacity: 1, transform: 'translateY(0) translateX(0)' },
  ]);
  chat.scrollTo({ top: chat.scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' });
}

function showTyping() {
  const message = document.createElement('div');
  message.className = 'message assistant typing-message';
  message.setAttribute('aria-label', 'Assistant is preparing a response');
  message.innerHTML = '<div class="avatar assistant-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 14.5 9.5 20.5 12l-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5 2.5-6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></div><div class="bubble"><span class="typing-indicator" aria-hidden="true"><span></span><span></span><span></span></span></div>';
  chat.appendChild(message);
  chat.scrollTo({ top: chat.scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' });
  return message;
}

function renderTrace(items = [], pending = false) {
  if (!items.length && !pending) {
    trace.innerHTML = '<div class="trace-placeholder"><span class="placeholder-icon">01</span><span>Ask a question to see how I find an answer.</span></div>';
    return;
  }

  const entries = items.map((item, index) => `
    <div class="trace-item" style="animation-delay:${Math.min(index * 55, 330)}ms">
      <span class="trace-icon">${String(index + 1).padStart(2, '0')}</span>
      <span>${escapeHtml(item)}</span>
    </div>
  `).join('');
  const loading = pending
    ? '<div class="trace-item pending"><span class="trace-icon"><span class="typing-indicator"><span></span><span></span><span></span></span></span><span>Finding the right information…</span></div>'
    : '';
  trace.innerHTML = entries + loading;
}

async function askAgent(rawQuestion) {
  const currentQuestion = rawQuestion.trim();
  if (!currentQuestion || sendButton.disabled) return;

  addMessage('user', currentQuestion);
  question.value = '';
  question.style.height = 'auto';
  sendButton.disabled = true;
  form.setAttribute('aria-busy', 'true');
  setSource('running');
  renderTrace(['Reading your question'], true);
  const typingMessage = showTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: currentQuestion }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Request failed');

    typingMessage.remove();
    addMessage('assistant', data.answer, data.source_used, data.citations || []);
    renderTrace(data.trace || []);
    setSource(data.source_used, sourceDetails[data.source_used] || 'Answer generated from reviewed evidence');
  } catch (error) {
    typingMessage.remove();
    addMessage('assistant', `Sorry, I couldn't complete that request. ${error.message}`);
    renderTrace(['Request could not be completed']);
    setSource('error');
  } finally {
    sendButton.disabled = false;
    form.removeAttribute('aria-busy');
    question.focus({ preventScroll: true });
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  askAgent(question.value);
});

question.addEventListener('input', () => {
  question.style.height = 'auto';
  question.style.height = `${Math.min(question.scrollHeight, 145)}px`;
});

question.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll('.example').forEach(button => {
  button.addEventListener('click', () => askAgent(button.textContent.trim()));
});

document.getElementById('newChat').addEventListener('click', () => {
  chat.innerHTML = initialMessage;
  renderTrace([]);
  setSource('');
  question.value = '';
  question.style.height = 'auto';
  question.focus({ preventScroll: true });
  playMotion(chat, [{ opacity: 0.65 }, { opacity: 1 }], { duration: 250 });
});

function openUploadDialog() {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  uploadStatus.textContent = '';
  uploadStatus.classList.remove('error');
  playMotion(modal.querySelector('.modal-card'), [
    { opacity: 0, transform: 'translateY(12px) scale(.98)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ]);
  window.setTimeout(() => document.getElementById('adminKey').focus(), reducedMotion ? 0 : 100);
}

function closeUploadDialog() {
  if (modal.classList.contains('hidden')) return;
  const card = modal.querySelector('.modal-card');
  if (reducedMotion || typeof card.animate !== 'function') {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    return;
  }
  const animation = card.animate(
    [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(8px) scale(.99)' }],
    { duration: 150, easing: 'ease-in', fill: 'forwards' },
  );
  animation.onfinish = () => {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  };
}

document.getElementById('openUpload').addEventListener('click', openUploadDialog);
document.getElementById('closeUpload').addEventListener('click', closeUploadDialog);
modal.querySelector('[data-close-upload]').addEventListener('click', closeUploadDialog);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeUploadDialog();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.getElementById('newChat').click();
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileName.textContent = file ? file.name : 'Choose a file to upload';
});

const dropZone = document.querySelector('.drop-zone');
dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  if (!event.dataTransfer.files.length) return;
  fileInput.files = event.dataTransfer.files;
  fileInput.dispatchEvent(new Event('change'));
});

uploadButton.addEventListener('click', async () => {
  const file = fileInput.files[0];
  const key = document.getElementById('adminKey').value;
  uploadStatus.classList.remove('error');
  if (!file) {
    uploadStatus.textContent = 'Choose a document before continuing.';
    uploadStatus.classList.add('error');
    playMotion(dropZone, [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 240 });
    return;
  }

  uploadButton.disabled = true;
  uploadButton.querySelector('span').textContent = 'Indexing document…';
  uploadStatus.textContent = 'Preparing your document for the knowledge base…';
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'X-Admin-Key': key },
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Upload failed');
    uploadStatus.textContent = `${data.file} is ready — ${data.chunks} sections added.`;
    fileInput.value = '';
    fileName.textContent = 'Choose a file to upload';
  } catch (error) {
    uploadStatus.textContent = error.message;
    uploadStatus.classList.add('error');
  } finally {
    uploadButton.disabled = false;
    uploadButton.querySelector('span').textContent = 'Index document';
  }
});

renderTrace([]);
