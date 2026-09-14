import os, re
base = "C:/PROJE 1/DG-STOK-THEME-V1/server/src"
results = []
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith('.ts'):
            p = os.path.join(root, f)
            try:
                with open(p, 'r', encoding='utf-8') as file:
                    content = file.read()
                    if any(k in content for k in ['omniRoute', 'executeMasterRequest', 'completeWithFreeModel', 'classifyByAi', 'matchCategoriesWithAI', 'omniRouteOrchestrator', 'omniRouteManager', 'aiGateway', 'openRouterManager', 'AIProviderConfig', 'chat/completions']):
                        rel = os.path.relpath(p, base)
                        matches = []
                        if 'omniRouteOrchestrator' in content or 'executeMasterRequest' in content:
                            matches.append('Router/Orchestrator')
                        if 'omniRouteManager' in content or 'discoverAndPersist' in content:
                            matches.append('OmniRoute Manager')
                        if 'categoryMatchEngine' in content or 'classifyByAi' in content:
                            matches.append('Category AI')
                        if 'aiGateway' in content or 'chatCompletion' in content:
                            matches.append('AI Gateway')
                        if 'openRouterManager' in content:
                            matches.append('OpenRouter Manager')
                        results.append((rel, ', '.join(set(matches))))
            except:
                pass
for r in sorted(results):
    print(f"{r[0]}: {r[1]}")
