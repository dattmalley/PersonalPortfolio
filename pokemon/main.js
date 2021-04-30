const pokeGrid = document.querySelector(".pokeGrid");
const loadButton = document.querySelector(".loadPokemon");
const fetchButton = document.querySelector(".fetchPokemonByID");

loadButton.addEventListener("click", () => {
  loadPage();
});

fetchButton.addEventListener("click", () => {
  let pokeId = prompt("Pokemon ID or Name:");
  console.log(pokeId)
  getAPIData(`https://pokeapi.co/api/v2/pokemon/${pokeId}`)
    .then((data) => populatePokeCard(data))
    // .catch(error => console.log(error));
});

async function getAPIData(url) {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.log(error);
    alert("Pokemon doesn't exist, catch the others!")
  }
}

function loadPage() {
  getAPIData(`https://pokeapi.co/api/v2/pokemon?limit=25`).then(
    async (data) => {
      for (const singlePokemon of data.results) {
        await getAPIData(singlePokemon.url).then((pokeData) =>
          populatePokeCard(pokeData)
        );
      }
    }
  );
}

function populatePokeCard(singlePokemon) {
  let pokeScene = document.createElement("div");
  pokeScene.className = "scene";
  let pokeCard = document.createElement("div");
  pokeCard.className = "card";
  pokeCard.addEventListener("click", () => {
    pokeCard.classList.toggle("is-flipped");
  });
  // card front
  pokeCard.appendChild(populateCardFront(singlePokemon));
  // card back
  pokeCard.appendChild(populateCardBack(singlePokemon));
  //append the all to pokeGrid
  pokeScene.appendChild(pokeCard);
  pokeGrid.appendChild(pokeScene);
}

function populateCardFront(pokemon) {
  let pokeFront = document.createElement("div");
  pokeFront.className = "card__face card__face--front";
  let frontLabel = document.createElement("h3");
  frontLabel.textContent = pokemon.name;
  let frontImage = document.createElement('img');
  frontImage.src = getImageFileName(pokemon)
  pokeFront.appendChild(frontImage);
  pokeFront.appendChild(frontLabel);
  return pokeFront;
}

function populateCardBack(pokemon) {
  let pokeBack = document.createElement("div");
  pokeBack.className = "card__face card__face--back";
  let backLabel = document.createElement("p");
  backLabel.textContent = "Type(s)";
  pokeBack.appendChild(backLabel);
  return pokeBack;
}

function getImageFileName(pokemon) {
  let pokeId
  if (pokemon.id < 10) pokeId = `00${pokemon.id}`
  if (pokemon.id > 9 && pokemon.id < 100) pokeId = `0${pokemon.id}`
  if (pokemon.id > 99 && pokemon.id < 810) pokeId = pokemon.id

  return `https://raw.githubusercontent.com/fanzeyi/pokemon.json/master/images/${pokeId}.png`
}
