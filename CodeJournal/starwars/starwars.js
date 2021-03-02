import { films } from '../data/films.js'

// let itemOne = document.querySelector('#item1')
// item1.textContent = films[2].title

let titlelist = document.querySelector('.titlesheet')

for (var i = 0; i < films.length; i++) {
    let title = films[i].title
    let newItem = document.createElement('li')
    newItem.textContent = titletitlelist.appendChild(newItem)
}
