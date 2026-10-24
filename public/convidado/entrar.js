// Página do link de convite: troca o código por uma sessão e vai para a festa.
(async function () {
  const codigo = decodeURIComponent(location.pathname.split('/').pop() || '').toLowerCase();
  const caixa = document.getElementById('conteudo');
  try {
    const r = await PV.chamar('POST', '/api/entrar', { corpo: { codigo } });
    PV.guardado.gravar('pv.token', r.token);
    // Tira o código da barra de endereço e do histórico.
    location.replace('/');
  } catch (erro) {
    caixa.innerHTML = `
      <div class="cadeado-grande">🔒</div>
      <h1 class="marca" style="font-size:3rem;margin-top:8px">Project V</h1>
      <p style="max-width:320px;margin:12px auto 0">${PV.esc(erro.message)}</p>`;
  }
})();
