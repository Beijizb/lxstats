import mysql from 'mysql2/promise';

let pool = null;

function getDbPool(env) {
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      user: env.DB_USER,
      password: env.DB_PASS,
      database: env.DB_NAME,
      port: parseInt(env.DB_PORT || '3306'),
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    });
  }
  return pool;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 静态页面 (GET /)
    if (path === "/" && request.method === "GET") {
      return new Response(renderHTML(), {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
    }

    // 2. 获取数据 (GET /api/stats)
    if (path === "/api/stats" && request.method === "GET") {
      return await handleGetStats(env);
    }

    // 3. 上报数据 (POST /api/report)
    if (path === "/api/report" && request.method === "POST") {
      return await handleReport(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

// --- 数据库逻辑 ---

async function handleGetStats(env) {
  const db = getDbPool(env);
  try {
    const [totalRows] = await db.execute(
      "SELECT count_value FROM global_stats WHERE id = 'total_requests'"
    );
    const [errorRows] = await db.execute(
      "SELECT source_name, error_count FROM source_errors ORDER BY error_count DESC"
    );

    const total = totalRows[0]?.count_value || 0;
    const errors = errorRows;

    const allSources = ['kw', 'kg', 'tx', 'wy', 'mg'];
    const statsMap = {};
    errors.forEach(e => statsMap[e.source_name] = e.error_count);
    
    const formattedErrors = allSources.map(src => ({
      source: src.toUpperCase(),
      count: statsMap[src] || 0
    }));

    return new Response(JSON.stringify({ total, errors: formattedErrors }), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

async function handleReport(request, env) {
  try {
    const body = await request.json();
    const { type, source } = body; 
    const db = getDbPool(env);

    if (type === 'request') {
      await db.execute(
        "UPDATE global_stats SET count_value = count_value + 1 WHERE id = 'total_requests'"
      );
    } else if (type === 'error' && source) {
      await db.execute(
        `INSERT INTO source_errors (source_name, error_count) 
         VALUES (?, 1) 
         ON DUPLICATE KEY UPDATE error_count = error_count + 1`,
        [source.toLowerCase()]
      );
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Access-Control-Allow-Origin": "*" } 
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

// --- 前端页面 HTML (已更名) ---

function renderHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LX 音源统计</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap');
        body { font-family: 'Noto Sans SC', sans-serif; }
        .glass-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
        }
        .gradient-bg {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .animate-fade-in {
            animation: fadeIn 0.5s ease-in-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body class="bg-gray-50 min-h-screen flex justify-center p-4 sm:p-8">

    <div class="w-full max-w-md animate-fade-in">
        <!-- 标题区 (已修改) -->
        <div class="text-center mb-6">
            <h1 class="text-2xl font-bold text-indigo-600 flex items-center justify-center gap-2">
                <i class="fas fa-music"></i> LX 音源统计
            </h1>
            <p class="text-gray-400 text-xs mt-1">实时服务监控面板</p>
        </div>

        <!-- 主容器 -->
        <div class="glass-card rounded-2xl p-6 space-y-6">
            
            <!-- 总请求数卡片 -->
            <div class="gradient-bg rounded-xl p-6 text-white text-center shadow-lg transform hover:scale-[1.02] transition-transform duration-200">
                <h2 class="text-sm font-medium opacity-90 mb-1">总请求数</h2>
                <div id="total-requests" class="text-5xl font-bold tracking-tight">
                    <i class="fas fa-circle-notch fa-spin text-2xl"></i>
                </div>
                <div class="text-xs opacity-60 mt-2">Total API Requests</div>
            </div>

            <!-- 错误统计区 -->
            <div>
                <h3 class="text-gray-700 font-bold mb-3 flex items-center gap-2">
                    <span class="w-1 h-4 bg-indigo-500 rounded-full"></span>
                    平台错误统计
                </h3>
                
                <div class="overflow-hidden rounded-lg border border-gray-100 shadow-sm">
                    <table class="w-full text-sm text-left">
                        <thead class="bg-indigo-50 text-indigo-900 font-semibold">
                            <tr>
                                <th class="px-4 py-3">平台</th>
                                <th class="px-4 py-3 text-right">错误次数</th>
                                <th class="px-4 py-3 text-right w-20">状态</th>
                            </tr>
                        </thead>
                        <tbody id="stats-body" class="bg-white divide-y divide-gray-50">
                            <tr><td colspan="3" class="px-4 py-4 text-center text-gray-400">正在加载数据...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 底部信息 -->
            <div class="text-center pt-2">
                <p class="text-xs text-gray-300">最后更新: <span id="last-updated">-</span></p>
            </div>
        </div>
    </div>

    <script>
        async function fetchData() {
            try {
                const response = await fetch('/api/stats');
                const data = await response.json();
                
                const totalEl = document.getElementById('total-requests');
                animateValue(totalEl, parseInt(totalEl.innerText) || 0, data.total, 1000);

                const tbody = document.getElementById('stats-body');
                tbody.innerHTML = '';
                
                data.errors.forEach(item => {
                    const isZero = item.count === 0;
                    const statusHtml = isZero 
                        ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">正常</span>'
                        : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">异常</span>';
                    
                    const row = \`
                        <tr class="hover:bg-gray-50 transition-colors">
                            <td class="px-4 py-3 font-medium text-gray-700">\${item.source}</td>
                            <td class="px-4 py-3 text-right font-mono \${item.count > 0 ? 'text-red-500 font-bold' : 'text-gray-400'}">\${item.count}</td>
                            <td class="px-4 py-3 text-right">\${statusHtml}</td>
                        </tr>
                    \`;
                    tbody.innerHTML += row;
                });

                const now = new Date();
                document.getElementById('last-updated').innerText = now.toLocaleTimeString();

            } catch (err) {
                console.error(err);
            }
        }

        function animateValue(obj, start, end, duration) {
            if (start === end) { obj.innerHTML = end; return; }
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                obj.innerHTML = Math.floor(progress * (end - start) + start);
                if (progress < 1) {
                    window.requestAnimationFrame(step);
                }
            };
            window.requestAnimationFrame(step);
        }

        fetchData();
        setInterval(fetchData, 10000);
    </script>
</body>
</html>
  `;
}
