document.getElementById('sendMessage').onclick = async function() {
    const userInput = document.getElementById('userInput').value;
    const responseDiv = document.getElementById('response');
  
    if (userInput.trim() === '') return;
  
    try {
      const res = await fetch('/api/user-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userInput }),
      });
  
      if (res.ok) {
        const data = await res.json();
  
        responseDiv.innerHTML += `<p><strong>User:</strong> ${userInput}</p>`;
  
        responseDiv.innerHTML += `<p><strong>Chat:</strong> ${data.response}</p>`;
  
        document.getElementById('userInput').value = '';
        responseDiv.scrollTop = responseDiv.scrollHeight;
      } else {
        alert('Failed to get a response. Please try again.');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred. Please try again.');
    }
  };
  