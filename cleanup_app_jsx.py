import sys
# V10 Delivery - Script de limpeza do App.jsx
path = r'c:\progetoentregas\src\App.jsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = '/** DELETE O QUE ESTIVER ABAIXO DISSO ATÉ O FINAL DA FUNÇÃO MEGABLOCK **/'
end_marker = 'const excluirPedido = async (id) => {'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    new_content = content[:start_idx] + content[end_idx:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f"Successfully removed block between {start_idx} and {end_idx}")
else:
    print(f"Markers not found: start={start_idx}, end={end_idx}")
