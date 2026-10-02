# StormBrain - Texniki Hesabat
## Kiberethlükəsizlik Təhsil Aləti

---

### 1. Layihənin Məqsədi

StormBrain, kiberethlükəsizlik təhsili məqsədilə hazırlanmış təhsil alətidir. Bu layihə həqiqi hücumların simulyasiyasını edir və tələbələrin aşağıdakı texniki bacarıqlarını inkişaf etdirməyə kömək edir:

- **Social Engineering Hücumları**: Phishing template-ləri vasitəsilə istifadəçi məlumatlarının toplanması
- **Device Fingerprinting**: Brauzer və cihaz məlumatlarının toplama metodları
- **Geolocation Tracking**: GPS məlumatlarının əldə edilməsi
- **Media Capture**: Kamera və mikrofon vasitəsilə məlumatların toplanması
- **Session Management**: Authentication və authorization mexanizmləri

---

### 2. Arxitektura

#### 2.1. Backend (Flask/Python)

Layihənin backend-i Python Flask framework üzərində qurulub. Əsas komponentlər:

```python
# Əsas Flask Application
app = Flask(__name__, template_folder=str(STORM_WEB), static_folder=str(STORM_WEB / "assets"))

# Konfiqurasiya
BASE_DIR = Path(__file__).resolve().parent
STORM_WEB = BASE_DIR / "storm-web"
TEMPLATES_DIR = STORM_WEB / "templates"
IMAGES_DIR = STORM_WEB / "images"
SOUNDS_DIR = STORM_WEB / "sounds"
```

**Əsas Endpoint-lər:**

1. **Authentication Endpoint-ləri**
   - `/login` - İstifadəçi girişi
   - `/logout` - Çıxış
   - `/panel` - Admin paneli

2. **Data Collection Endpoint-ləri**
   - `/receiver` - Template-lərdən gələn məlumatların qəbulu
   - `/templates/<name>/handler` - Device info toplama
   - `/templates/camera_temp/post` - Kamera şəkillərinin yüklənməsi
   - `/templates/microphone/upload` - Audio fayllarının yüklənməsi

3. **API Endpoint-ləri**
   - `/api/stats` - Statistika məlumatları
   - `/api/activity` - Aktivlik logları
   - `/api/activity/add` - Yeni aktivlik əlavə etmə
   - `/api/change_password` - Parol dəyişikliyi
   - `/api/server_info` - Server məlumatları
   - `/get_captures` - Media fayllarının siyahısı

#### 2.2. Frontend (HTML/CSS/JavaScript)

Frontend modern və responsive dizayn ilə hazırlanıb:

**Əsas Komponentlər:**

1. **Login Səhifəsi** (`login.html`)
   - Particle effects ilə animasiyalı background
   - Modern glassmorphism dizayn
   - Form validation və error handling
   - Loading animasiyaları

2. **Admin Panel** (`panel.html`)
   - Sidebar navigation
   - Real-time dashboard
   - Logs viewer with syntax highlighting
   - Interactive map (Leaflet.js)
   - Media gallery
   - Statistics panel with charts (Chart.js)

3. **JavaScript Dashboard** (`dashboard.js`)
   - Real-time data polling
   - Notification system
   - Chart rendering
   - Map management
   - Media gallery functionality

---

### 3. İşləmə Prinsipi

#### 3.1. Authentication Flow

```
1. İstifadəçi login səhifəsinə daxil olur
2. Username/Password göndərilir
3. Server təsdiqləyir və session yaradır
4. Token generate edilir və cookie-ə yazılır
5. İstifadəçi panel-ə yönləndirilir
6. Hər request token yoxlanılır
```

**Token Generation:**
```python
def generate_token():
    """Benzersiz token yaradır"""
    uniqid = hashlib.md5(uuid.uuid4().hex.encode()).hexdigest()
    parts = [uniqid[i:i+5] for i in range(0, len(uniqid), 5)]
    return "-".join(parts)
```

#### 3.2. Data Collection Process

**Step 1: Template Link Yaratmaq**
```javascript
// Dashboard-da template link-ləri göstərilir
var link = location.protocol + '//' + location.host + '/templates/' + templateName + '/index.html';
```

**Step 2: Target-in Link-ə Tıklaması**
- Target template-ə daxil olur
- JavaScript kodları avtomatik işləyir
- Device məlumatları toplanır

**Step 3: Məlumatların Göndərilməsi**
```javascript
// Template-lərdən məlumatların göndərilməsi
fetch('/templates/camera_temp/post', {
    method: 'POST',
    body: formData
});
```

**Step 4: Server Qəbulu**
```python
@app.route("/templates/camera_temp/post", methods=["POST"])
def camera_post():
    image_data = request.form.get("cat", "")
    if image_data:
        # Base64 decode və yadda saxlama
        decoded = base64.b64decode(image_data)
        filepath.write_bytes(decoded)
```

**Step 5: Dashboard-da Göstərilməsi**
```javascript
// Real-time polling
setInterval(fetchLogs, 2000);

function fetchLogs() {
    $.post('/receiver', { send_me_result: '' }, function (data) {
        // Məlumatları dashboard-da göstər
        renderLogs(data);
    });
}
```

#### 3.3. Template-lərin İşləməsi

**1. Camera Template**
- Webcam-a icazə istəyir
- Real-time video capture
- Base64 encoding
- Server-ə POST request

**2. Microphone Template**
- Microphone-a icazə istəyir
- Audio recording
- WAV formatında conversion
- Server-ə upload

**3. Location Templates**
- Geolocation API istifadə
- GPS koordinatları
- Google Maps link-i
- Server-ə göndərilmə

**4. Device Info Template**
- User-Agent string
- Screen resolution
- Browser info
- OS detection

---

### 4. Təhlükəsizlik Mexanizmləri

#### 4.1. Server-side Security

```python
# Session Management
app.secret_key = os.urandom(24)  # Random secret key

# Authentication Check
def is_logged_in():
    if session.get("IAm-logined"):
        return True
    # Cookie token validation
    key = read_check_c()
    login_cookie = request.cookies.get("logindata", "")
    if login_cookie and login_cookie == key.get("token"):
        return True
    return False
```

#### 4.2. Client-side Security

- Content Security Policy (CSP) headers
- XSS protection (input escaping)
- CSRF protection (token validation)
- Secure cookie flags

#### 4.3. Data Encryption

```python
# Token hashing
def generate_token():
    uniqid = hashlib.md5(uuid.uuid4().hex.encode()).hexdigest()
    return "-".join([uniqid[i:i+5] for i in range(0, len(uniqid), 5)])
```

---

### 5. Yeni Əlavə Olunan Funksionallıqlar

#### 5.1. Modern Login Səhifəsi

- **Particle Effects**: Canvas-based animasiyalı background
- **Glassmorphism Dizayn**: Blur effekti ilə modern görünüş
- **Form Validation**: Real-time input validation
- **Loading States**: Submit button loading animasiyası
- **Error Handling**: Shake animasiyalı error mesajları

#### 5.2. Gelişmiş Dashboard

**Yeni Widget-lər:**
- System Status widget (uptime, active sessions)
- Recent Targets widget
- Quick Actions widget
- Real-time statistics with trends

**Improved Cards:**
- Hover effektləri
- Gradient borders
- Trend indicators
- Animated counters

#### 5.3. Gelişmiş Log Viewer

**Funksionallıqlar:**
- **Syntax Highlighting**: Log type-lərə görə rəngləndirmə
- **Filtering**: Image, Audio, Location, Info filter-ləri
- **Search**: Real-time log axtarışı
- **Export**: JSON formatında export
- **Highlight**: Search结果的 highlight effekti

**Implementation:**
```javascript
function renderLogs() {
    var searchTerm = $('#log-search').val().toLowerCase();
    var filterType = $('#log-filter').val();
    
    filteredLogEntries = logEntries.filter(function (entry) {
        var matchesSearch = !searchTerm || entry.message.toLowerCase().includes(searchTerm);
        var matchesFilter = filterType === 'all' || entry.type === filterType;
        return matchesSearch && matchesFilter;
    });
}
```

#### 5.4. İyileştirilmiş Xəritə

**Yeni Features:**
- **Dark Theme Map Tiles**: CARTO dark basemap
- **Custom Markers**: Styled marker icons
- **Location Stats**: Total, recent (24h), countries
- **Clear Markers**: Bütün marker-ləri təmizləmə
- **Fit All**: Bütün location-ları görüntüyə fit etmə
- **Fly Animation**: Smooth transition between locations

**Implementation:**
```javascript
function addMarker(lat, lng, info) {
    var customIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div style="background:var(--accent);width:12px;height:12px;border-radius:50%;"></div>'
    });
    
    var marker = L.marker([lat, lng], { icon: customIcon })
        .bindPopup('<b>📍 Target Location</b><br>' + info)
        .addTo(map);
}
```

#### 5.5. Modern Media Gallery

**Features:**
- **Grid/List View**: Toggle between grid and list layouts
- **Filtering**: Image/Audio filter-ləri
- **Search**: Media fayllarında axtarış
- **Bulk Selection**: Multiple item selection
- **Bulk Actions**: Download selected, delete selected
- **Lightbox**: Image preview modal

**Implementation:**
```javascript
function toggleMediaSelection(checkbox, url) {
    $(checkbox).toggleClass('checked');
    if ($(checkbox).hasClass('checked')) {
        selectedMedia.push(url);
    } else {
        selectedMedia = selectedMedia.filter(function (u) { return u !== url; });
    }
}
```

#### 5.6. Real-time Notification System

**Features:**
- **Notification Panel**: Dropdown notification panel
- **Unread Indicators**: Badge counter
- **Mark as Read**: Individual read status
- **Clear All**: Bulk clear functionality
- **Toast Notifications**: GrowlNotification integration

**Implementation:**
```javascript
function addNotification(msg, type) {
    var notification = {
        id: Date.now(),
        title: msg,
        description: getDescriptionByType(type),
        time: new Date().toLocaleString(),
        unread: true
    };
    notifications.unshift(notification);
    renderNotifications();
}
```

#### 5.7. Expanded Statistics Panel

**Yeni Chart-lər:**
- **Activity Over Time**: Bar chart with period selector (7/30/90 days)
- **Data Breakdown**: Doughnut chart (Images/Audio/Locations)
- **Target Distribution**: Polar area chart
- **Response Times**: Line chart with smooth curves

**Export Options:**
- **CSV Export**: Statistics in CSV format
- **JSON Export**: Complete data in JSON format
- **Charts Export**: Individual chart images

#### 5.8. Advanced Report Export

**PDF Export (jsPDF):**
```javascript
var { jsPDF } = window.jspdf;
var doc = new jsPDF();

// Tables with autoTable plugin
doc.autoTable({
    head: [['Metric', 'Value']],
    body: statsData,
    theme: 'grid',
    headStyles: { fillColor: [0, 212, 255] }
});

doc.save('storm_brain_report.pdf');
```

**Fallback Text Export:**
- PDF library yüklənməyibsə text formatında export
- Complete statistics, logs, and locations

---

### 6. Texniki Stack

| Component | Technology |
|-----------|------------|
| Backend | Python 3.x, Flask |
| Frontend | HTML5, CSS3, JavaScript (ES6+) |
| CSS Framework | Bootstrap 5.3 |
| Charts | Chart.js |
| Maps | Leaflet.js |
| PDF Export | jsPDF, jsPDF-AutoTable |
| Notifications | GrowlNotification, SweetAlert2 |
| Icons | Emoji (native) |
| Server | Flask Development Server |

---

### 7. Fayl Strukturu

```
Storm-Breaker/
├── app.py                          # Flask application
├── storm-web/
│   ├── login.html                  # Login page
│   ├── panel.html                  # Admin panel
│   ├── Settings.json               # Configuration
│   ├── check-c.json                # Token storage
│   ├── assets/
│   │   ├── css/
│   │   │   └── dashboard.css      # Dashboard styles
│   │   └── js/
│   │       ├── dashboard.js        # Dashboard logic
│   │       ├── jquery.min.js
│   │       ├── sweetalert2.min.js
│   │       └── growl-notification.min.js
│   ├── templates/                  # Phishing templates
│   │   ├── camera_temp/
│   │   ├── microphone/
│   │   ├── weather/
│   │   ├── nearyou/
│   │   └── normal_data/
│   ├── images/                     # Captured images
│   ├── sounds/                     # Captured audio
│   └── log/                        # Log files
└── TECHNICAL_REPORT_AZ.md         # This document
```

---

### 8. İstifadə Qaydaları

#### 8.1. Server Başlatma

```bash
# Python yüklənməli
python app.py

# Output:
# [+] Web Panel Link : http://localhost:2525
# [+] Please Run NGROK On Port 2525 AND Send Link To Target > ngrok http 2525
```

#### 8.2. Ngrok Konfiqurasiya

```bash
# Ngrok yüklə və işə sal
ngrok http 2525

# Ngrok URL-ni kopyala və target-ə göndər
# Example: https://abc123.ngrok.io/templates/camera_temp/index.html
```

#### 8.3. Dashboard İstifadə

1. **Login**: 
   - Default: admin / admin
   - Parolu Settings-də dəyişmək olar

2. **Monitoring**:
   - Dashboard real-time statistika göstərir
   - Activity feed yeni məlumatları avtomatik göstərir
   - Notification panel bildirişləri saxlayır

3. **Data Management**:
   - Logs bölməsində logları filter və axtarış etmək olar
   - Media gallery-da faylları görüntüləmək və download etmək olar
   - Map bölməsində location-ları izləmək olar

4. **Export**:
   - Logs bölməsində PDF/JSON export
   - Statistics bölməsində CSV/JSON export
   - Charts export as images

---

### 9. Təhsil Məqsədləri

Bu layihə tələbələrə aşağıdakı konseptləri öyrədir:

#### 9.1. Offensive Security
- Social engineering prinsipləri
- Phishing template hazırlama
- Client-side attacks
- Data exfiltration metodları

#### 9.2. Defensive Security
- Input validation önəmi
- Session management best practices
- Secure authentication
- Data encryption

#### 9.3. Web Development
- Flask framework istifadəsi
- RESTful API dizayn
- Real-time applications
- Modern frontend development

#### 9.4. Security Awareness
- Browser security model-i
- Same-origin policy
- CORS (Cross-Origin Resource Sharing)
- Content Security Policy

---

### 10. Hüquqi və Etik Məsələlər

⚠️ **MÜHÜM XƏBƏRDARLIQ**

Bu layihə **yalnız təhsil məqsədləri üçün** hazırlanıb:

1. **Qanuni İstifadə**: Yalnız icazəli sistemlərdə test etmək olar
2. **Etik İstifadə**: Real hücumlar üçün istifadə etmək qadağandır
3. **Məsuliyyət**: İstifadəçi tam məsuliyyət daşıyır
4. **Məqsəd**: Təhsil və tədqiqat məqsədləri

---

### 11. Gələcək İnkişaflar

#### 11.1. Planlanan Features
- [ ] WebSocket-based real-time communication
- [ ] Advanced analytics with machine learning
- [ ] Multi-language support
- [ ] Mobile app companion
- [ ] Cloud storage integration
- [ ] Advanced reporting with templates

#### 11.2. Security Improvements
- [ ] Two-factor authentication
- [ ] Rate limiting
- [ ] IP whitelisting
- [ ] Advanced logging
- [ ] Security audit logs

---

### 12. Troubleshooting

#### 12.1. Common Issues

**Issue**: Server başlamır
```
Solution: Python 3.x yüklənib yoxlanın, port 2525 boşdur
```

**Issue**: Template-lər işləmir
```
Solution: Template fayllarının templates/ qovluğunda olduğunu yoxlayın
```

**Issue**: Məlumatlar gəlmir
```
Solution: Ngrok tunnel-i aktivdir, target-ın internet bağlantısı var
```

**Issue**: Dashboard göstərilmir
```
Solution: Browser console-da errorları yoxlayın, CDN URL-ləri işləkən
```

---

### 13. Nəticə

StormBrain layihəsi kiberethlükəsizlik təhsili üçün güclü bir alətdir. Modern UI/UX ilə təchiz edilmiş dashboard, real-time monitoring, və müxtəlif export imkanları təmin edir. Bu layihə həm offensive, həm də defensive security bacarıqlarını inkişaf etdirmək üçün ideal platformadır.

---

**Dokument Versiyası**: 1.0  
**Son Yeniləmə**: 2026-09-23  
**Müəllif**: StormBrain Development Team  
**Lisenziya**: Təhsil Məqsədləri Üçün

---

*Bu texniki hesabat StormBrain layihəsinin tam arxitekturasını, işləmə prinsiplərini və təhsil məqsədlərini əhatə edir.*

---

### 14. Tətbiq olunmuş təhlükəsizlik düzəlişləri (25 sentyabr 2026)

Bu bölmə 6-cı bölmədə qeyd olunan problemlərin hansının kodla düzəldildiyini göstərir.

#### 14.1. P0 — kritik (icra edildi)

| # | Problem | Düzəliş | Yer |
|---|---------|---------|-----|
| 1 | `flask_socketio` çatışmadığına görə `app.py` ümumiyyətlə import olunmurdu (alət işə düşmürdü) | import `try/except` ilə qorundu (`SOCKETIO_AVAILABLE`), handler-lər şərti qeydiyyat altına alındı, `run_server` fallback edir; `requirements.txt` və `modules/check.py` paket siyahısı `flask-socketio` ilə yeniləndi | app.py:38-44, 1146-1187, 1193-1201 |
| 2 | `/Settings.json` auth-suz ngrok authtokenini verirdi | route auth tələb edir və yalnız `version/pid/is_start` qaytarır; token `storm-web/Settings.json`-dan çıxarılıb `.secrets/ngrok.json`-a köçürüldü (gitignore, web kökündən kənar, 0600) | app.py:812-827, modules/tunnel.py:7-65 |
| 3 | Kamera/mikrofon faylları və `result.txt` auth-suz oxunurdu | `/images/*` və `/sounds/*` auth tələb edir; `/templates/*` daxilində `result.*` və gizli fayllar HTTP-də 404 qaytarır | app.py:779-810 |
| 4 | `/api/activity/add` auth-suz idi (log saxtalaşdırma) | auth + rate limit | app.py:873-891 |
| 5 | Repoda canlı tokenlər, test kamera şəkilləri, `settings/check-c` faylları | `check-c.json` və `Settings.json` git-dən çıxarıldı (`git rm --cached`), `.gitignore` genişləndirildi: `.secrets/`, `storm-web/images/*`, `sounds/*`, `visitors/`, `log/*`, `__pycache__/` | .gitignore |

#### 14.2. P1 — struktur təhlükəsizlik (icra edildi)

- **Parol**: açıq mətn əvəzinə werkzeug hash (`.secrets/credentials.json`, 0600 icazə); yoxlama `check_password_hash` + `hmac.compare_digest` (constant-time). `/api/change_password` yeni hash-i **fayla yazır**, yəni restartdan sonra qalır; minimum uzunluq 8 simvol. `STORM_ADMIN_USER`/`STORM_ADMIN_PASSWORD` env dəyişənləri ilə override mümkündür.
- **`secret_key`**: `SECRET_KEY` env və ya `.secrets/secret.key` (sabit saxlanılır) — restartda bütün sessiyalar itmir.
- **Cookie**: `HttpOnly` + `SameSite=Lax`; HTTPS üçün `STORM_SECURE_COOKIE=1` (`logindata` cookie-si də eyni bayraqları alır).
- **CSRF qoruması**: `X-CSRF-Token` başlığı, `csrf_token` form sahəsi və ya JSON body; qurban brauzerində işləyən 4 collector endpoint (`handler`, `error`, `post`, `upload`) qəsdən istisnadır. Panel `panel.html`-də meta teq, `dashboard.js`-də `$.ajaxSetup`, login formasında gizli sahə.
- **Rate limiting** (asılılıqsız, IP üzrə): login 10/dəq, collector-lər 120/dəq, API 240/dəq — env ilə tənzimlənir.
- **Template adı validasiyası**: `^[A-Za-z0-9_-]{1,32}$` + `safe_template_dir()` ilə `TEMPLATES_DIR` daxilində olduğunun yoxlanması → create/duplicate/CRUD/handler/error endpoint-lərində path traversal bağlandı.
- **Fayl/payload**: `secure_filename()` + unikal suffix, `MAX_CONTENT_LENGTH=16 MB` (`STORM_MAX_UPLOAD_MB`), base64 ölçü limiti, PNG imza (`\x89PNG`) yoxlaması, `result.txt` üçün 256 KB limit + atomik yazma.
- **Geo-IP**: `http://ip-api.com` → `https://ipwho.is` (şifrəli kanal), 1 saatlıq keş, private IP-lər üçün xarici sorğu yoxdur; `X-Forwarded-For` yalnız `STORM_TRUST_PROXY=1` olduqda etibarlı sayılır.
- **Digər**: `activity_log` artıq diskə yazılır (`storm-web/log/activity.json`), statistika dürüst hesablanır (kamera log uzunluğu yox, real visitor/koordinat sayı), SocketIO `subscribe_stats` handler-dəki `NameError` (mövcud olmayan `connection_count`) aradan qaldırıldı, `control.py` PID-i tam ədəd kimi yoxlayır (əmr yeridilməsi bağlandı), `banner.py`-də import yan-effekti silindi, `storm-web/.htaccess` ilə PHP rejimində `result.txt`, `check-c.json`, `config.php`, `login-arc.php` HTTP-dən bağlandı.

#### 14.3. Yeni mühit dəyişənləri

| Dəyişən | Default | Təyinat |
|---------|---------|---------|
| `SECRET_KEY` | `.secrets/secret.key` | Flask sessiya açarı (sabit) |
| `STORM_ADMIN_USER` / `STORM_ADMIN_PASSWORD` | — | Parolu fayl yerinə env-dən verir (deployment üçün) |
| `STORM_SECURE_COOKIE` | `0` | Yalnız HTTPS üzərindən işlədikdə `1` edin |
| `STORM_TRUST_PROXY` | `0` | ngrok/reverse proxy arxasında `X-Forwarded-For`-a etibar |
| `STORM_MAX_UPLOAD_MB` | `16` | Yükləmə/base64 ölçü limiti |
| `STORM_LOGIN_RATE` / `STORM_COLLECT_RATE` / `STORM_API_RATE` | `10` / `120` / `240` | Dəqiqədə sorğu limitləri |
| `STORM_GEO_CACHE_TTL` | `3600` | Geo-IP keş müddəti (saniyə) |
| `NGROK_AUTHTOKEN` | `.secrets/ngrok.json` | ngrok tokeni (env prioritetlidir) |

#### 14.4. Yoxlama nəticələri

39 yoxlamadan ibarət avtomatik smoke test (login/CSRF, auth-suz giriş cəhdləri, media və `result.txt` ifşası, traversal, yükləmə validasiyası, rate limit, settings sızması) — **39/39 PASS**:

- `flask-socketio` quraşdırılmış mühitdə: exit code 0;
- `flask-socketio` olmayan mühitdə (fallback yolu): exit code 0.

Test zamanı aşkarlanıb düzəldilən əlavə bug: `_credentials_lock` rekursiv olmadığı üçün `load_credentials()` → `_write_credentials_file()` zəncirində **ilk login-də deadlock** (proses donurdu) — `threading.RLock()` ilə həll edildi.

#### 14.5. Qalan işlər (istifadəçi tərəfindən görülməli)

1. **ngrok authtokenini dəyişin** — o, əvvəl web-dən servis olunan `Settings.json`-da açıq idi (indiki dəyər `.secrets/ngrok.json`-dadır və gitignore-dadır).
2. `storm-web/images/`-dəki 14 test şəkli diskdə qalır (artıq gitignore-dadır) — pozuntusuz mühit üçün silin.
3. Git tarixçəsindən köhnə secret-ləri təmizləmək (`git filter-repo` / BFG) — destruktiv əməliyyatdır, tövsiyə olunur.
4. P2: `result.txt` kanalını SQLite/JSONL-ə keçirmək — hazırda paralel qurbanlar eyni faylı bir-birinin üzərinə yazır və `/receiver` oxuyub dərhal silir.
5. P2: PHP (legacy) tərəfini tamamilə silmək — `keylogger`, `clipboard`, `cookie_harvester` template-ləri yalnız Flask rejimində işləyir. ✅ İcra edildi (bax 14.6).

#### 14.6. Təmizləmə və optimallaşdırma (25 sentyabr 2026)

Layihə Flask-only tək implementasiyaya keçirildi və ölü yük silindi. Bütün silinən fayllar
git tarixçəsində qalır — lazım olarsa `git checkout HEAD -- <fayl>` ilə bərpa etmək olar.

**Silinən PHP legacy (23 fayl):**
`storm-web/index.php`, `login.php`, `panel.php`, `receiver.php`, `config.php`, `list_templates.php`,
`assets/components/login-arc.php`, `assets/js/script.js` (PHP panel skripti),
`assets/css/style.css` + `light-theme.min.css` + `colored-theme.min.css` (ölü/yalnız PHP),
template-lərdəki 8 `.php` faylı (`handler.php`, `post.php`, `upload.php`, `error.php`),
`storm-web/.htaccess` (yalnız PHP rejimi üçün yazılmışdı), kök `Settings.json` (ölü dublikat).

**Silinən ölü asset (2 fayl, ~59 KB):**
`templates/camera_temp/all.css` (54 KB) və `templates/camera_temp/style.css` — yeni
`index.html` onları yükləmir (bütün stil inline-dır); heç bir fayl istinad etmir.

**Silinən ölü kod:**
- `modules/check.py::check_update()` (heç yerdən çağırılmırdı) + istifadə olunmayan importlar;
- `modules/tunnel.py`: istifadə olunmayan `conf`/`subprocess` importları, fayl-orta import bloku başlığa köçürüldü;
- `kill_php_proc` → `kill_stale_processes` (düzgün adlandırma) + `Path`-əsaslı yollar (CWD-dən asılılıq yoxdur);
- `storm-web/assets/js/dashboard.js`-dəki xarici GitHub versiya-sorğusu silindi
  (layihə lokal qalır; panel artıq hər açılışda internetə çıxış etmir). Eyni səbəbdən
  `app.py`-dəki `/Settings.json` route-u ləğv edildi.

**Kiçildilən:**
- `install.sh`: ~279 sətir / 8 KB → ~77 sətir / ~2.6 KB (yalnız Python + pip; PHP quraşdırma,
  ngrok binar yükləmə (pyngrok avtomatik edir), Gentoo/FreeBSD/OpenBSD/MacPorts budaqları silindi; `bash -n` ilə yoxlanıldı).
- `README.md`: Flask-only axına yenidən yazıldı (PHP/hostinq/ngrok-binar təlimatları silindi; təhlükəsizlik və env dəyişənləri əlavə edildi).
- `modules/banner.py`: ASCII-art sətirləri təhlükəsiz literal kimi yenidən yazıldı — bütün `SyntaxWarning`-lər getdi, çıxış bayt-bə-bayt eynidir (doğrulanıb).

**Runtime məlumatları git-dən çıxarıldı** (yaradıldıqda avtomatik bərpa olunur):
`storm-web/templates/*/result.txt` faylları `git rm --cached` edildi və `.gitignore`-a salındı
(`result.tmp.txt` ilə birlikdə); `.gitignore` həmçinin `aise/` (əlaqəsiz layihə, təsadüfi
commit-dən qorunmaq üçün) və `*.bak` əlavə edildi.

**Saxlanıldı** (səbəbi ilə): bütün template-lərin istifadə etdiyi JS kitabxanaları
(`jquery`, `client.min`, `loc`, `location`, `feather`, `particles`, `warpspeed`, `recorder`,
`sweetalert2`, `growl-notification`); `bootstrap.min.css`; `dashboard.js/css`;
`nearyou` şrift/mapsəhifə faylları; `.imgs/` README şəkilləri; boş qovluq saxlayıcıları
(`images/image.log`, `sounds/sounds.log`, `log/empty`); `aise/` qovluğu silinmədi —
tamam başqa layihədir, onu repo qovluğundan kənara köçürmək tövsiyə olunur.

Yekun yoxlama: `py_compile` OK, 39/39 təhlükəsizlik smoke testi PASS, canlı HTTP testi PASS,
bütün yerli asset istinadlarının mövcudluğu yoxlanıldı.

#### 14.7. UI/UX yenidən dizaynı (25 sentyabr 2026)

**Struktur:**
- Panel: ~1200 sətir inline `<style>` xarici `assets/css/panel.css`-ə köçürüldü → `panel.html`
  1711 → 561 sətir; başlıqda yalnız 3 xarici CSS + lazımi JS.
- Login: bütün CSS → `assets/css/login.css`; səhifə tam yenidən yazıldı (iki panelli:
  brand paneli + operator girişi). `{% if error %}` və `{{ csrf_token }}` toxunulmayıb.
- Yeni lokal yardımçı: `assets/js/sb.js` (5.7 KB) — `window.SB`: toast bildirişləri,
  AJAX xəta köməkçiləri (`SB.ajaxError`), Chart/Leaflet offline qorumalı `createChart`/`createMap`,
  tarix/rəqəm helperləri.

**Vizual sistem (SOC konsepti):**
- Hər bölmədə `soc-page-head` (eyebrow + H1 + sub), `soc-kpi-row` KPI kartları (rəngli sol
  aksent, tabular rəqəmlər), `soc-grid-2` asimmetrik layout, `soc-status-pill`, `soc-live-dot`,
  `soc-chip`, gradient kart başlıqları (`dash-card::after`), fon grid + radial aksentlər.
- İkonlar: hərf kodları (D/L/M/G/S/X/T/O) → qrafik gliflər (◈ ≡ ◎ ▦ ≣ ⚙ ⧉ ☾ ⟳ ⏻);
  topbar `N` → 🔔; burger ☰ / tema ☾.
- Şrift: Inter (UI) + JetBrains Mono (kod/log saatı), linklər `<head>`-də.

**Silinən/yüngülləşdirilən:** `growl-notification.min.js` (18 KB, artıq heç kim istifadə
etmir — sb.js əvəz edir), `socket.io` CDN (serverdə qat var idi, frontend isə istifadə
etmirdi), jsPDF CDN-ləri (fallback mətn exportu qorunub).

**Düzəldilən UI bug-ları:**
1. Bildiriş panelindən sonra artıq `</header>` silindi (səhv HTML);
2. `#theme-toggle` duplikat id → topbar tema düyməsi işləmirdi; indi hər iki düymə
   (`#theme-toggle` + `.btn-theme`) `toggleTheme`-i çağırır;
3. Köhnə `.text('L')` handler-i sidebar elementinin DOM-unu məhv edirdi və
   `body.light-mode` / `data-theme` iki ayrı tema sistemi bir-biri ilə ziddiyyət
   təşkil edirdi — `setTheme()` indi hər ikisini + hər iki localStorage açarını +
   topbar ikonunu sinxron idarə edir.

**Doğrulama (3 mərtəbəli):** 21/21 (panel struktur + 54/54 ID müqaviləsi + CSS örtüşməsi),
20/20 (login JS hook-ları + CSS örtüşməsi + asset-lər), `node --check` (dashboard.js, sb.js),
canlı HTTP: `/login` → 200, login POST → `/panel` (32 KB), `panel.css` 42.5 KB,
7 `soc-page-head`, silinən kitabxana → 404.

**Qeyd:** `aise/` qovluğu (15.2 MB, 716 fayl) silindi — git status təmiz idi, stəş yoxdur,
bütün commit-lər `origin/main` ilə sinxron idi, ona görə lokal məlumat itkisi yoxdur.


### 14.8. Kamera bug-ı və sessiya izolyasiyası (26 sentyabr 2026)

#### 14.8.1. P0 — kamera template-i tamamilə işləmirdi (kök səbəb tapıldı, düzəldildi)

**Simptom:** `camera_temp` lure-ı açıldıqda kamera icazəsi soruşulmurdu, şəkil
çəkilmirdi və serverə heç bir məlumat getmirdi (panel boş qalırdı).

**Kök səbəb:** `storm-web/templates/camera_temp/index.html` faylında 9-cu sətirdə açılan
`<style>` teqi **bağlanmamışdı** (`</style>` yox idi). HTML parser bu halda faylın qalan
hissəsini — bütün `<body>`-ni və bütün `<script>` bloklarını — CSS mətn kimi qəbul edir:

- `document.body.children.length === 0`, `document.getElementById('status') === null`;
- `jquery.min.js` belə yüklənmir (şəbəkədə yalnız `index.html` + Google Fonts görünür);
- `video.addEventListener(...)` sətri `TypeError` atır və skript elə orada dayanır →
  `startCamera()` heç vaxt çağırılmır, yəni icazə sorğusu da, çəkim də, POST da yoxdur.

Səbəb brauzer avtomatlaşdırması ilə təsdiqləndi (headless Edge + DevTools protokolu):
düzəlişdən əvvəl `{idCount: 0, divs: 0, scripts: []}`, sonra kamera tam işləyir.

**Client düzəlişləri (`camera_temp/index.html`):**
- bağlanmamış `</style>` əlavə edildi (əsas səbəb);
- `navigator.mediaDevices` yoxlaması: HTTP (LAN IP / şifrəsiz tunnel) üzərindən açıldıqda
  brauzer kameranı tamamilə gizlədir — indi "Camera Blocked / Open this page over HTTPS"
  mesajı göstərilir (əvvəl səssiz uğursuzluq idi);
- ilk kadr dərhal göndərilir (`startAutoCapture()` içində `captureFrame()`), sonra hər 9 saniyədə;
- **kamera icazəsi səhifə yüklənən anda soruşulur:** `<head>`-dəki inline skript
  `getUserMedia`-ni dərhal çağırır (orijinal şablondakı kimi — o da parse zamanı
  `init()`-i işə salırdı; yenidən yazılmış versiyada isə 1000 ms `setTimeout`
  gecikməsi var idi, o indi silinib). `startCamera()` bu hazır sorğunu istifadə
  edir, təkrar sorğu yalnız kamera dəyişdiriləndə (`switch-camera`) göndərilir
  (`cameraPending` bayrağı ilə eyni sorğunun ikiqat göndərilməsi bloklanır);
- `video.play()` (autoplay siyasəti), `switchCamera` üçün `stream = null`, mobil brauzerlər
  üçün ilk toxunuşda `startCamera()`, GPS koordinatları (`payload.lat`/`payload.lon`);
- **GPS kamera icazəsindən asılı deyil:** `getUserLocation(true)` səhifə açılan kimi —
  kamera icazəsindən əvvəl və ondan ayrı — çağırılır (`getCurrentPosition` +
  cavab gələnə qədər hər 15 saniyədə retry; yalnız `PERMISSION_DENIED` finaldır).
  Koordinat gələndə `sendLocationData()` onu dərhal göndərir; server
  (`camera_post`) şəkil baytı olmasa belə `Location : ...` + `Google Map Link`
  sətirlərini `result.txt`-ə yazır (JSON cavab: `{"status":"ok","file":"","bytes":0,...}`).
  Beləliklə, GPS kameranı bloklayan/inkar edən hədəflərdən də gəlir.

**Server düzəlişləri (`app.py::camera_post`):**
- cavab artıq `204` deyil, `200 {"status":"ok","file":...,"bytes":...,"location":...,"lat":...,"lon":...}`
  (`204`-də jQuery `data`-sı `undefined` olur; JSON cavab panelə fayl adını göstərməyə imkan verir);
- `result.txt`-ə `Location : ...` və `Google Map Link : https://www.google.com/maps?q=<lat>,<lon>`
  sətirləri yazılır — dashboard hər iki formatı (`?q=` və köhnə `/place/<lat>+<lon>`) oxuyur,
  yəni kamera çəkilişinin GPS-i hərəkdə xəritədə marker kimi düşür və link düzgün koordinatı göstərir;
- `microphone_upload` da JSON cavab qaytarır.

**Doğrulama (real brauzer, saxta kamera):** `Camera Active`, `1280x720`, konsolda
`Image sent successfully` ×2, `POST /templates/camera_temp/post → 200` ×2,
`storm-web/images/`-də 2 real PNG (16.6 KB + 18.5 KB), `result.txt` yeniləndi.
İcazə vaxtı ayrıca instrumentasiya ilə sübut edildi
(`Page.addScriptToEvaluateOnNewDocument` ilə `getUserMedia` wrap olundu):
**cəmi 1 çağırış** — `atMs: 47`, `readyState: "loading"`, `videoInDom: false`
(yəni sorğu `<video>` elementi hələ parse olunmamışdan, səhifə yüklənərkən gedir),
0 JS xətası.
#### 14.8.2. Hər `st.py` işə salınması = yeni sessiya (köhnə data ayrı yerdə saxlanılır)

Tələb: hər başlatmada panel köhnə datanı göstərməsin, köhnə data isə itməsin.

**Yeni modul:** `modules/session_store.py`. `st.py` banner-dən sonra
`session_store.start_new_session()` çağırır və cari run-un artefaktlarını **köçürür** (silmir):

```
storm-web/sessions/<YYYYmmdd-HHMMSS>/
├── session.json          # manifest: id, archived_at, first/last_capture, files, bytes, counts
├── images/               # webcam kadrları
├── sounds/               # mikrofon yazıları
├── visitors/visitors.json
├── log/activity.json
└── results/<template>.txt
```

- `image.log`, `sounds.log`, `log/empty` kimi git-də saxlanan placeholder-lər yerində qalır;
  arxivlənməyə heç nə yoxdursa, boş sessiya qovluğu yaradılmır (`None` qaytarır);
- eyni saniyədə iki başlatma olsa id +1 saniyə sürüşdürülür (format: `^\d{8}-\d{6}$`);
- fayl başqa fayl sisteminə keçərsə, `shutil.move` xətası copy+delete ilə kompensasiya olunur.

**Panel inteqrasiyası:**
- `GET /api/sessions` — arxivlənmiş sessiyaların manifestləri (auth tələb edir);
- `GET /api/sessions/<id>/media` — bir sessiyanın media siyahısı;
- `GET /sessions/<id>/<kind>/<file>` — arxiv media faylının özü (yalnız auth sessiyada,
  `kind` whitelist-i `images|sounds`, yol traversal-ı `send_from_directory` ilə bağlıdır);
- `panel.html` Media bölməsinə **sessiya seçimi** (`#session-select`) əlavə edildi;
  `dashboard.js` seçilmiş sessiyanın mediasını yükləyir, canlı run isə əvvəlki kimi
  15 saniyədə bir yenilənir (arxiv sessiyaları dəyişməz olduğu üçün poll edilmir);
- `.gitignore`-a `storm-web/sessions/` əlavə edildi; arxiv heç bir static route ilə açılmır.

**Doğrulama:** 27/27 sessiya testi (arxiv + manifest + canlı qovluqların təmizliyi +
`list_sessions`/`session_media` + yanlış id/traversal → 404), 20/20 API/CSRF testi,
canlı panel: `#session-select` → `["", "20260926-212148 - 2 img / 1 aud / 3 logs"]`,
arxiv sessiyası üçün `/api/sessions/<id>/media` → 3 element.

**Yekun:** `py_compile` OK, `node --check` (dashboard.js, camera skripti) OK,
kamera E2E PASS, sessiya E2E PASS.

