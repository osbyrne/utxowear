<script>
  let color = 'blue';

  function handleClick() {
    color = color === 'blue' ? 'red' : 'blue';
  }
</script>

<button
  style={`background-color: ${color}; color: white; padding: 10px 20px; border-radius: 5px; cursor: pointer`}
  on:click={handleClick}
>
  Change Color
</button>

export default button